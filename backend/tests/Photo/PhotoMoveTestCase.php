<?php

namespace App\Tests\Photo;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\Photo;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Uid\Uuid;

/**
 * Items, photos and reading back what the projection shows, for the tests of PhotoMover and app:photo:move.
 */
abstract class PhotoMoveTestCase extends KernelTestCase
{
    protected EntityManagerInterface $em;
    protected TimberItemProjector $projector;
    protected User $admin;
    protected Attribute $fotos;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->projector = self::getContainer()->get(TimberItemProjector::class);

        $this->em->persist($this->admin = new User('Alexander', UserRole::Superadmin, User::hashToken('a')));
        $this->em->persist($this->fotos = new Attribute('Fotos', AttributeType::Photo, isSeries: true));
        $this->em->flush();
    }

    protected function item(string $tag, ?Uuid $parent = null): Uuid
    {
        $id = Uuid::v7();
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $id, EventType::Created, ['parent_id' => $parent?->toRfc4122()], new \DateTimeImmutable(), $this->admin));
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $id, EventType::TagAssigned, ['tag_number' => $tag], new \DateTimeImmutable(), $this->admin));
        $this->em->flush();
        $this->projector->project($id);

        return $id;
    }

    protected function target(string $tag): TimberItem
    {
        return $this->em->getRepository(TimberItem::class)->findOneBy(['tagNumber' => $tag]);
    }

    /** A photo taken at and shown on the item. */
    protected function photo(Uuid $item, ?string $id = null, string $takenAt = '2026-09-01 10:00:00'): Uuid
    {
        $photoId = null === $id ? Uuid::v7() : Uuid::fromString($id);
        $now = new \DateTimeImmutable();
        $this->em->persist(new Photo($photoId, $item, $this->admin, 1000, hash('sha256', $photoId->toRfc4122()), new \DateTimeImmutable($takenAt.' UTC'), $now));
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::AttributeRecorded,
            ['attribute_id' => $this->fotos->id->toRfc4122(), 'value' => $photoId->toRfc4122()], $now, $this->admin, receivedAt: $now));
        $this->em->flush();
        $this->projector->project($item);

        return $photoId;
    }

    /** @return list<string> photo IDs the projection shows on the item, sorted */
    protected function photosOn(Uuid $item): array
    {
        $records = $this->em->getConnection()->fetchOne('SELECT value_records FROM timber_item_state WHERE timber_item_id = ?', [$item->toBinary()]);
        $ids = array_column(false === $records ? [] : json_decode($records, true), 'value');
        sort($ids);

        return $ids;
    }

    protected function events(EventType $type): int
    {
        return (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events WHERE type = ?', [$type->value]);
    }

    /** @return list<list<array<string, mixed>>> every projection row, to compare before and after a rebuild */
    protected function projectionRows(): array
    {
        $db = $this->em->getConnection();

        return [
            $db->fetchAllAssociative('SELECT id, parent_id, tag_number, has_children, voided_at FROM timber_items ORDER BY id'),
            $db->fetchAllAssociative('SELECT timber_item_id, attribute_id, value_records FROM timber_item_state ORDER BY timber_item_id, attribute_id'),
        ];
    }

    /** Rebuilds all projections and asserts they equal what the incremental projection left. */
    protected function assertRebuildChangesNothing(): void
    {
        $before = $this->projectionRows();
        $this->projector->rebuildAll();
        self::assertEquals($before, $this->projectionRows());
        // rebuildAll() clears the entity manager.
        $this->admin = $this->em->find(User::class, $this->admin->id);
    }
}
