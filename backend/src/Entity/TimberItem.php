<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Projection of timber_item_events, see TimberItem in frontend/shared/contract.ts.
 * Written only by TimberItemProjector, read-only everywhere else.
 */
#[ORM\Entity(readOnly: true)]
#[ORM\Table(name: 'timber_items')]
class TimberItem
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public readonly Uuid $id;

    #[ORM\Column(type: UuidType::NAME, nullable: true)]
    public readonly ?Uuid $parentId;

    /** Latest tag_assigned. */
    #[ORM\Column(length: 32, nullable: true)]
    public readonly ?string $tagNumber;

    #[ORM\Column]
    public readonly bool $hasChildren;

    /** Device time of the created event. */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, columnDefinition: 'DATETIME(6) NOT NULL')]
    public readonly \DateTimeImmutable $createdAt;

    /** User id; no foreign key, like everything in a projection it only mirrors the events. */
    #[ORM\Column(type: UuidType::NAME)]
    public readonly Uuid $createdBy;

    /** Server time of the voided event. Voided items stay here so late events still find them, but leave the snapshot. */
    #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true, columnDefinition: 'DATETIME(6) DEFAULT NULL')]
    public readonly ?\DateTimeImmutable $voidedAt;
}
