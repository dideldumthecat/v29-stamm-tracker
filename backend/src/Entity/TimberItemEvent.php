<?php

namespace App\Entity;

use App\Repository\TimberItemEventRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Append-only: rows are only ever inserted. All properties are readonly and the entity is
 * marked read-only for Doctrine, so it never issues an UPDATE. Corrections and voids are new events.
 *
 * Order for projections: received_at, then id (TimberItemEventRepository::findInReceiptOrder()).
 * Never the device time recorded_at: of conflicting values the one that reached the server last wins.
 */
#[ORM\Entity(repositoryClass: TimberItemEventRepository::class, readOnly: true)]
#[ORM\Table(name: 'timber_item_events')]
#[ORM\Index(name: 'idx_events_item_received', columns: ['timber_item_id', 'received_at'])]
#[ORM\Index(name: 'idx_events_reference', columns: ['reference_id'])]
class TimberItemEvent
{
    /** Server time of arrival; decides which of conflicting values wins. Never sent by the device. */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, columnDefinition: 'DATETIME(6) NOT NULL')]
    public readonly \DateTimeImmutable $receivedAt;

    /**
     * @param Uuid                 $id           generated on the device, makes resending harmless
     * @param Uuid                 $timberItemId no foreign key: timber_items is a projection of these events
     * @param array<string, mixed> $data         payload per type, see Event in contract.ts
     * @param Uuid|null            $referenceId  the event a "corrected" or "voided" event refers to
     */
    public function __construct(
        #[ORM\Id]
        #[ORM\Column(type: UuidType::NAME)]
        public readonly Uuid $id,
        #[ORM\Column(type: UuidType::NAME)]
        public readonly Uuid $timberItemId,
        #[ORM\Column(length: 32, enumType: EventType::class)]
        public readonly EventType $type,
        #[ORM\Column(type: Types::JSON)]
        public readonly array $data,
        /** Device time. */
        #[ORM\Column(type: Types::DATETIME_IMMUTABLE, columnDefinition: 'DATETIME(6) NOT NULL')]
        public readonly \DateTimeImmutable $recordedAt,
        #[ORM\ManyToOne]
        #[ORM\JoinColumn(name: 'user_id', nullable: false)]
        public readonly User $user,
        #[ORM\Column(type: UuidType::NAME, nullable: true)]
        public readonly ?Uuid $referenceId = null,
    ) {
        $this->receivedAt = new \DateTimeImmutable();
    }
}
