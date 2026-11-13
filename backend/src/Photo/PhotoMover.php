<?php

namespace App\Photo;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\Photo;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Hangs photos on another stem or beam (T03: nothing is changed, two events are appended per photo):
 * a voided event on the recording that put the photo on its source, and a new attribute_recorded event on the target.
 * The photos row stays as it is, it only says where the photo was taken.
 */
class PhotoMover
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
    ) {
    }

    /**
     * Checks everything and returns what move() would do; writes nothing.
     *
     * @param list<Uuid> $photoIds
     *
     * @return list<PhotoMove>
     *
     * @throws \DomainException with a message for the user, if any photo cannot be moved
     */
    public function plan(array $photoIds, TimberItem $target): array
    {
        $this->photoAttribute();
        if (null !== $target->voidedAt) {
            throw new \DomainException(\sprintf('%s is voided.', $target->tagNumber));
        }
        $ids = array_map(static fn (Uuid $id) => $id->toRfc4122(), $photoIds);
        if ($duplicates = array_keys(array_filter(array_count_values($ids), static fn (int $count) => $count > 1))) {
            throw new \DomainException(\sprintf('The same photo is given more than once: %s.', implode(', ', $duplicates)));
        }

        $moves = [];
        foreach ($photoIds as $photoId) {
            $photo = $this->em->find(Photo::class, $photoId) ?? throw new \DomainException(\sprintf('No photo with the ID %s.', $photoId->toRfc4122()));
            $assignments = $this->assignments($photoId);
            if (1 !== \count($assignments)) {
                throw new \DomainException($assignments ? \sprintf('Photo %s is on more than one item (%s); this needs a manual look.', $photoId->toRfc4122(), implode(', ', array_column($assignments, 'tag'))) : \sprintf('Photo %s is not on any item.', $photoId->toRfc4122()));
            }
            ['recording' => $recording, 'item' => $item, 'tag' => $tag] = $assignments[0];
            $moves[] = new PhotoMove($photoId, $photo->takenAt, $item, $tag, $target->tagNumber, $recording, $item->equals($target->id));
        }

        return $moves;
    }

    /**
     * Moves the photos in one transaction, then projects every item involved.
     *
     * @param list<Uuid> $photoIds
     *
     * @return list<PhotoMove> the planned moves; those already at the target are skipped
     *
     * @throws \DomainException like plan(), before anything is written
     */
    public function move(array $photoIds, TimberItem $target, User $author): array
    {
        $moves = $this->plan($photoIds, $target);
        $attribute = $this->photoAttribute();

        $this->em->wrapInTransaction(function () use ($moves, $target, $author, $attribute): void {
            $now = new \DateTimeImmutable();
            $projected = [];
            foreach (array_filter($moves, static fn (PhotoMove $move) => !$move->alreadyAtTarget) as $move) {
                $this->em->persist(new TimberItemEvent(Uuid::v7(), $move->sourceId, EventType::Voided, [], $now, $author, $move->recordingId, receivedAt: $now));
                $this->em->persist(new TimberItemEvent(Uuid::v7(), $target->id, EventType::AttributeRecorded,
                    ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $move->photoId->toRfc4122()], $now, $author, receivedAt: $now));
                $projected[$move->sourceId->toRfc4122()] = $move->sourceId;
                $projected[$target->id->toRfc4122()] = $target->id;
            }
            $this->em->flush();
            foreach ($projected as $id) {
                $this->projector->project($id);
            }
        });

        return $moves;
    }

    /**
     * Where the photo is shown: its recordings that no void refers to.
     *
     * @return list<array{recording: Uuid, item: Uuid, tag: ?string}>
     */
    public function assignments(Uuid $photoId): array
    {
        $db = $this->em->getConnection();
        $rows = $db->fetchAllAssociative(
            'SELECT rec.id AS recording, rec.timber_item_id AS item, i.tag_number AS tag FROM timber_item_events rec
                LEFT JOIN timber_items i ON i.id = rec.timber_item_id
                WHERE rec.type = ? AND JSON_VALUE(rec.data, ?) = ? AND JSON_VALUE(rec.data, ?) = ?
                AND NOT EXISTS (SELECT 1 FROM timber_item_events void WHERE void.type = ? AND void.reference_id = rec.id)',
            [EventType::AttributeRecorded->value, '$.attribute_id', $this->photoAttribute()->id->toRfc4122(), '$.value', $photoId->toRfc4122(), EventType::Voided->value],
        );

        return array_map(static fn (array $row) => [
            'recording' => Uuid::fromBinary($row['recording']),
            'item' => Uuid::fromBinary($row['item']),
            'tag' => $row['tag'],
        ], $rows);
    }

    private function photoAttribute(): Attribute
    {
        $attributes = $this->em->getRepository(Attribute::class)->findBy(['type' => AttributeType::Photo, 'active' => true]);
        if (1 !== \count($attributes)) {
            throw new \DomainException(\sprintf('Expected exactly one active attribute of type photo, found %d.', \count($attributes)));
        }

        return $attributes[0];
    }
}
