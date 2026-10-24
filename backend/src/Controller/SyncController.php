<?php

namespace App\Controller;

use App\Api\Timestamp;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Projection\TimberItemProjector;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/**
 * SyncRequest → SyncResponse in frontend/src/api/contract.ts. All events are checked before anything is
 * written, so a bad request (400) stores nothing.
 */
final class SyncController extends AbstractController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
    ) {
    }

    #[Route('/api/sync', methods: ['POST'])]
    public function __invoke(Request $request, User $user): JsonResponse
    {
        $events = $request->toArray()['events'] ?? null;
        if (!\is_array($events) || !array_is_list($events)) {
            throw new BadRequestHttpException('events must be a list.');
        }

        $known = $this->knownEventIds($events);
        $existingItems = [];
        $new = [];
        // Strictly increasing in the order sent: the last value sent wins even if the device times are equal.
        $receivedAt = new \DateTimeImmutable();
        foreach ($events as $index => $event) {
            $event = $this->parse($event, $user, $receivedAt->modify('+'.\count($new).' microseconds'), $index);
            $itemId = $event->timberItemId->toRfc4122();
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
            if (!isset($known[$event->id->toRfc4122()])) {
                $known[$event->id->toRfc4122()] = true;
                $new[] = $event;
            }
        }

        $this->em->wrapInTransaction(function () use ($new): void {
            $affected = [];
            foreach ($new as $event) {
                $this->em->persist($event);
                $affected[$event->timberItemId->toRfc4122()] = $event->timberItemId;
                if (EventType::Created === $event->type && $event->data['parent_id']) {
                    $affected[$event->data['parent_id']] = Uuid::fromString($event->data['parent_id']);
                }
            }
            $this->em->flush();
            foreach ($affected as $itemId) {
                $this->projector->project($itemId);
            }
        });

        return $this->json(['accepted_event_ids' => array_column($events, 'id')]);
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
            default => throw $fail('type must be created, tag_assigned or attribute_recorded.'),
        };

        return new TimberItemEvent($id, $timberItemId, $type, $data, $recordedAt, $user, receivedAt: $receivedAt);
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
            AttributeType::Choice => \is_string($value) && Uuid::isValid($value)
                && $this->em->find(AttributeOption::class, Uuid::fromString($value))?->attribute === $attribute,
            // TODO: check that the photo exists once photos are uploaded.
            AttributeType::Photo => \is_string($value) && Uuid::isValid($value),
        };
        if (!$valid) {
            throw $fail(\sprintf('data.value does not fit the %s attribute.', $attribute->type->value));
        }

        return ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $value];
    }
}
