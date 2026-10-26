<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Events the server refused to store, kept as sent so nothing recorded on a device is lost.
 * Append-only like timber_item_events; the administration decides what happens to them.
 */
#[ORM\Entity(readOnly: true)]
#[ORM\Table(name: 'rejected_syncs')]
class RejectedSync
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public readonly Uuid $id;

    /**
     * @param string      $reason e.g. "tag_already_taken", see SyncResponse in contract.ts
     * @param list<array> $events the rejected events exactly as the device sent them
     */
    public function __construct(
        #[ORM\ManyToOne]
        #[ORM\JoinColumn(name: 'user_id', nullable: false)]
        public readonly User $user,
        #[ORM\Column(length: 64)]
        public readonly string $reason,
        #[ORM\Column(type: Types::JSON)]
        public readonly array $events,
        #[ORM\Column(type: Types::DATETIME_IMMUTABLE, columnDefinition: 'DATETIME(6) NOT NULL')]
        public readonly \DateTimeImmutable $receivedAt = new \DateTimeImmutable(),
    ) {
        $this->id = Uuid::v7();
    }
}
