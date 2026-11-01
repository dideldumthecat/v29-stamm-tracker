<?php

namespace App\Controller;

use App\Api\Timestamp;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\RejectedSync;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Projection\TimberItemProjector;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/**
 * SyncRequest → SyncResponse in frontend/src/api/contract.ts. All events are checked before anything is
 * written, so a bad request (400) stores nothing. A taken tag is not a bad request: only the affected events are
 * rejected (kept in rejected_syncs), the rest of the batch is stored.
 */
final class SyncController extends AbstractController
{
    private const TAG_ALREADY_TAKEN = 'tag_already_taken';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
        private readonly LoggerInterface $logger,
    ) {
    }

    #[Route('/api/sync', methods: ['POST'])]
    public function __invoke(Request $request, User $user): JsonResponse
    {
        try {
            return $this->sync($request, $user);
        } catch (BadRequestHttpException $e) {
            $this->logger->warning('Sync rejected: '.$e->getMessage());
            throw $e;
        }
    }

    private function sync(Request $request, User $user): JsonResponse
    {
        $events = $request->toArray()['events'] ?? null;
        if (!\is_array($events) || !array_is_list($events)) {
            throw new BadRequestHttpException('events must be a list.');
        }

        // Any invalid event rejects the whole batch with a 400, which the app shows to the user.
        $known = $this->knownEventIds($events);
        // Strictly increasing in the order sent: the last value sent wins even if the device times are equal.
        $receivedAt = new \DateTimeImmutable();
        $parsed = [];
        foreach ($events as $index => $event) {
            $parsed[$index] = $this->parse($event, $user, $receivedAt->modify('+'.$index.' microseconds'), $index);
        }

        [$takenItems, $takenEvents] = $this->takenTags($parsed, $known);
        $existingItems = [];
        $new = [];
        $accepted = [];
        $rejected = [];
        foreach ($parsed as $index => $event) {
            $itemId = $event->timberItemId->toRfc4122();
            $takenTag = $takenItems[$itemId] ?? $takenEvents[$index] ?? null;
            if (null !== $takenTag) {
                $rejected[$index] = ['event_id' => $event->id->toRfc4122(), 'timber_item_id' => $itemId, 'tag_number' => $takenTag, 'reason' => self::TAG_ALREADY_TAKEN];
                continue;
            }
            if (EventType::Created === $event->type) {
                // Also keeps parent chains free of cycles, which the recursive inheritance in the projector relies on.
                $parentId = $event->data['parent_id'];
                if ($parentId && !($existingItems[$parentId] ??= null !== $this->em->find(TimberItem::class, Uuid::fromString($parentId)))) {
                    throw new BadRequestHttpException(\sprintf('events[%d]: unknown parent timber item.', $index));
                }
                $existingItems[$itemId] = true;
            } elseif (!($existingItems[$itemId] ??= null !== $this->em->find(TimberItem::class, $event->timberItemId))) {
                throw new BadRequestHttpException(\sprintf('events[%d]: unknown timber item without a preceding created event.', $index));
            }
            $accepted[] = $event->id->toRfc4122();
            if (!isset($known[$event->id->toRfc4122()])) {
                $known[$event->id->toRfc4122()] = true;
                $new[] = $event;
            }
        }

        $this->em->wrapInTransaction(function () use ($new, $rejected, $events, $user): void {
            if ($rejected) {
                $this->em->persist(new RejectedSync($user, self::TAG_ALREADY_TAKEN, array_values(array_intersect_key($events, $rejected))));
            }
            $affected = [];
            foreach ($new as $event) {
                $this->em->persist($event);
                $affected[$event->timberItemId->toRfc4122()] = $event->timberItemId;
                if (EventType::Voided === $event->type) {
                    // The stem's has_children may change; projecting it re-projects the beam too.
                    $stem = $this->em->find(TimberItem::class, $event->timberItemId)->parentId;
                    $affected[$stem->toRfc4122()] = $stem;
                }
                if (EventType::Created === $event->type && $event->data['parent_id']) {
                    $affected[$event->data['parent_id']] = Uuid::fromString($event->data['parent_id']);
                }
            }
            $this->em->flush();
            foreach ($affected as $itemId) {
                $this->projector->project($itemId);
            }
        });

        $message = \sprintf('Sync: %d received, %d new, %d known, %d rejected', \count($parsed), \count($new), \count($accepted) - \count($new), \count($rejected));
        $context = ['received' => \count($parsed), 'new' => \count($new), 'known' => \count($accepted) - \count($new), 'rejected' => array_values($rejected)];
        $rejected ? $this->logger->warning($message, $context) : $this->logger->info($message, $context);

        return $this->json(['accepted_event_ids' => $accepted, 'rejected' => array_values($rejected)]);
    }

    /**
     * Tags another item already holds – on the server or earlier in this request – in two cases:
     * - An item created with a taken tag (its first tag_assigned in the request): a duplicate capture of the same plate.
     *   The item and all beams below it are rejected; the first capture stays, the device of the second learns about it.
     * - Any later tag_assigned (a new plate, a corrected typo) with a taken tag: only that event is rejected,
     *   the item keeps its previous tag.
     *
     * @param array<int, TimberItemEvent> $events
     * @param array<string, true>         $known  resent events are stored already and never rejected afterwards
     *
     * @return array{array<string, string>, array<int, string>} taken tag per rejected item id (beams carry the tag of
     *                                                          their rejected parent), and per rejected event index
     */
    private function takenTags(array $events, array $known): array
    {
        $firstTagIndex = [];
        $createdHere = [];
        foreach ($events as $index => $event) {
            $itemId = $event->timberItemId->toRfc4122();
            if (EventType::TagAssigned === $event->type) {
                $firstTagIndex[$itemId] ??= $index;
            } elseif (EventType::Created === $event->type) {
                $createdHere[$itemId] = true;
            }
        }

        $claimed = [];
        $voidedHere = [];
        // ponytail: a tag given up by a new plate earlier in the same request still counts as taken; it is free from the next sync on.
        $claim = function (string $tag, string $itemId) use (&$claimed, &$voidedHere): bool {
            // A voided item gives its tag free, also one voided earlier in this request (remove a beam, add the next one).
            $holders = array_map(static fn (TimberItem $item) => $item->id->toRfc4122(), $this->em->getRepository(TimberItem::class)->findBy(['tagNumber' => $tag, 'voidedAt' => null]));
            $holders = array_diff($holders, array_keys($voidedHere));
            if (array_diff([...$holders, $claimed[$tag] ?? $itemId], [$itemId])) {
                return false;
            }
            $claimed[$tag] = $itemId;

            return true;
        };

        $takenItems = [];
        $takenEvents = [];
        foreach ($events as $index => $event) {
            $itemId = $event->timberItemId->toRfc4122();
            if (isset($takenItems[$itemId])) {
                continue;
            }
            if (EventType::Voided === $event->type) {
                $voidedHere[$itemId] = true;
            } elseif (EventType::Created === $event->type) {
                $parentId = $event->data['parent_id'];
                $tag = isset($firstTagIndex[$itemId]) ? $events[$firstTagIndex[$itemId]]->data['tag_number'] : null;
                if ($parentId && isset($takenItems[$parentId])) {
                    $takenItems[$itemId] = $takenItems[$parentId];
                } elseif (null !== $tag && !$claim($tag, $itemId)) {
                    $takenItems[$itemId] = $tag;
                }
            } elseif (EventType::TagAssigned === $event->type && !isset($known[$event->id->toRfc4122()])
                && !(isset($createdHere[$itemId]) && $firstTagIndex[$itemId] === $index)
                && !$claim($event->data['tag_number'], $itemId)) {
                $takenEvents[$index] = $event->data['tag_number'];
            }
        }

        return [$takenItems, $takenEvents];
    }

    /**
     * @return array<string, true> ids (RFC 4122) of the request's events that are already stored
     */
    private function knownEventIds(array $events): array
    {
        $ids = [];
        foreach ($events as $event) {
            if (\is_string($event['id'] ?? null) && Uuid::isValid($event['id'])) {
                $ids[] = Uuid::fromString($event['id'])->toBinary();
            }
        }
        $known = $this->em->getConnection()->fetchFirstColumn(
            'SELECT id FROM timber_item_events WHERE id IN (?)',
            [$ids],
            [ArrayParameterType::BINARY],
        );

        return array_fill_keys(array_map(static fn (string $id) => Uuid::fromBinary($id)->toRfc4122(), $known), true);
    }

    private function parse(mixed $event, User $user, \DateTimeImmutable $receivedAt, int $index): TimberItemEvent
    {
        $fail = static fn (string $problem) => new BadRequestHttpException(\sprintf('events[%d]: %s', $index, $problem));
        $uuid = static fn (mixed $value) => \is_string($value) && Uuid::isValid($value) ? Uuid::fromString($value) : null;

        if (!\is_array($event) || 1 !== ($event['schema_version'] ?? null) || !\is_array($event['data'] ?? null)) {
            throw $fail('not an event of schema_version 1 with data.');
        }
        $id = $uuid($event['id'] ?? null) ?? throw $fail('id must be a UUID.');
        $timberItemId = $uuid($event['timber_item_id'] ?? null) ?? throw $fail('timber_item_id must be a UUID.');
        $recordedAt = Timestamp::parse($event['recorded_at'] ?? null) ?? throw $fail('recorded_at must be an ISO 8601 timestamp.');
        $data = $event['data'];

        $type = EventType::tryFrom($event['type'] ?? '');
        $data = match ($type) {
            EventType::Created => \array_key_exists('parent_id', $data) && (null === $data['parent_id'] || $uuid($data['parent_id']))
                ? ['parent_id' => $data['parent_id'] ? $uuid($data['parent_id'])->toRfc4122() : null]
                : throw $fail('data.parent_id must be a UUID or null.'),
            EventType::TagAssigned => \is_string($data['tag_number'] ?? null) && '' !== $data['tag_number']
                ? ['tag_number' => $data['tag_number']]
                : throw $fail('data.tag_number must be a non-empty string.'),
            EventType::AttributeRecorded => $this->attributeData($data, $fail),
            EventType::Voided => [] === $data ? [] : throw $fail('data must be empty.'),
            default => throw $fail('type must be created, tag_assigned, attribute_recorded or voided.'),
        };
        // The app names the beam only; the reference to its created event is the server's business.
        $referenceId = EventType::Voided === $type ? $this->createdEventOfBeam($timberItemId) ?? throw $fail('voided needs an existing beam.') : null;

        return new TimberItemEvent($id, $timberItemId, $type, $data, $recordedAt, $user, $referenceId, $receivedAt);
    }

    /** Null for a stem or an unknown item: the app removes beams only. Also finds beams that are voided already. */
    private function createdEventOfBeam(Uuid $timberItemId): ?Uuid
    {
        $created = $this->em->getConnection()->fetchAssociative(
            'SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ? AND JSON_VALUE(data, ?) IS NOT NULL',
            [$timberItemId->toBinary(), EventType::Created->value, '$.parent_id'],
        );

        return $created ? Uuid::fromBinary($created['id']) : null;
    }

    /**
     * @param \Closure(string): BadRequestHttpException $fail
     */
    private function attributeData(array $data, \Closure $fail): array
    {
        $attributeId = \is_string($data['attribute_id'] ?? null) && Uuid::isValid($data['attribute_id']) ? Uuid::fromString($data['attribute_id']) : null;
        $attribute = $attributeId ? $this->em->find(Attribute::class, $attributeId) : null;
        if (!$attribute) {
            throw $fail('data.attribute_id is not a known attribute.');
        }

        $value = $data['value'] ?? null;
        $valid = match ($attribute->type) {
            AttributeType::Boolean => \is_bool($value),
            AttributeType::Number => \is_int($value) || \is_float($value),
            AttributeType::Text => \is_string($value),
            AttributeType::Date => \is_string($value) && (\DateTimeImmutable::createFromFormat('!Y-m-d', $value) ?: null)?->format('Y-m-d') === $value,
            AttributeType::Month => \is_string($value) && (\DateTimeImmutable::createFromFormat('!Y-m', $value) ?: null)?->format('Y-m') === $value,
            AttributeType::Choice => \is_string($value) && Uuid::isValid($value)
                && $this->em->find(AttributeOption::class, Uuid::fromString($value))?->attribute === $attribute,
            // The file is uploaded separately (PhotoController) and may arrive after this event: not checked.
            AttributeType::Photo => \is_string($value) && Uuid::isValid($value),
        };
        if (!$valid) {
            throw $fail(\sprintf('data.value does not fit the %s attribute.', $attribute->type->value));
        }

        return ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $value];
    }
}
