<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Metadata of an uploaded JPEG; the file is in PhotoStorage under the same id. Insert-only like the events.
 * Which timber item shows the photo is decided by the attribute_recorded event holding its id, not by this row.
 */
#[ORM\Entity(readOnly: true)]
#[ORM\Table(name: 'photos')]
#[ORM\Index(name: 'idx_photos_item', columns: ['timber_item_id'])]
#[ORM\Index(name: 'idx_photos_sha256', columns: ['sha256'])]
class Photo
{
    /**
     * @param Uuid               $id           generated on the device, makes a repeated upload harmless
     * @param Uuid               $timberItemId where the photo was taken; no foreign key, the item may not be synced yet
     * @param \DateTimeImmutable $takenAt      device time (import: EXIF or file date)
     */
    public function __construct(
        #[ORM\Id]
        #[ORM\Column(type: UuidType::NAME)]
        public readonly Uuid $id,
        #[ORM\Column(type: UuidType::NAME)]
        public readonly Uuid $timberItemId,
        #[ORM\ManyToOne]
        #[ORM\JoinColumn(name: 'user_id', nullable: false)]
        public readonly User $user,
        #[ORM\Column(options: ['unsigned' => true])]
        public readonly int $size,
        #[ORM\Column(type: Types::STRING, length: 64, columnDefinition: 'CHAR(64) NOT NULL')]
        public readonly string $sha256,
        #[ORM\Column(type: Types::DATETIME_IMMUTABLE, columnDefinition: 'DATETIME(6) NOT NULL')]
        public readonly \DateTimeImmutable $takenAt,
        #[ORM\Column(type: Types::DATETIME_IMMUTABLE, columnDefinition: 'DATETIME(6) NOT NULL')]
        public readonly \DateTimeImmutable $uploadedAt = new \DateTimeImmutable(),
    ) {
    }
}
