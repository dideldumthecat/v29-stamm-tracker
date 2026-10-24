<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Projection: current values of one timber item and attribute.
 * Written only by TimberItemProjector, read-only everywhere else.
 */
#[ORM\Entity(readOnly: true)]
#[ORM\Table(name: 'timber_item_state')]
class TimberItemState
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public readonly Uuid $timberItemId;

    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public readonly Uuid $attributeId;

    /**
     * AttributeValueRecord[] exactly as in the contract, oldest first: series every recording, otherwise only the latest.
     * Not named "values": that is a reserved word in MariaDB.
     *
     * @var list<array{value: bool|int|float|string, recorded_at: string, user_id: string, event_id: string}>
     */
    #[ORM\Column(type: Types::JSON)]
    public readonly array $valueRecords;
}
