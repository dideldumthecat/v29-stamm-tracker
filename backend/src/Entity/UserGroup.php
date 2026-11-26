<?php

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * A group decides which attributes its members see in the capture app, see AdminGroup in frontend/admin/src/api/contract.ts.
 * It either sees all attributes, future ones included, or only the enabled ones (`attributes`, unused otherwise).
 * Only the app applies it; the server enforces nothing. Roles are unrelated: they govern access to the administration.
 */
#[ORM\Entity]
#[ORM\Table(name: 'user_groups')]
#[ORM\UniqueConstraint(name: 'uniq_user_groups_name', columns: ['name'])]
class UserGroup
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    /** @var Collection<int, Attribute> */
    #[ORM\ManyToMany(targetEntity: Attribute::class)]
    #[ORM\JoinTable(name: 'user_group_attributes')]
    #[ORM\JoinColumn(name: 'group_id', onDelete: 'CASCADE')]
    #[ORM\InverseJoinColumn(name: 'attribute_id', onDelete: 'CASCADE')]
    public private(set) Collection $attributes;

    public function __construct(
        #[ORM\Column(length: 255)]
        public string $name,
        #[ORM\Column]
        public bool $seesAllAttributes = false,
        ?Uuid $id = null,
    ) {
        $this->id = $id ?? Uuid::v7();
        $this->attributes = new ArrayCollection();
    }

    /** @param list<Attribute> $attributes */
    public function enable(array $attributes): void
    {
        $this->attributes = new ArrayCollection($attributes);
    }
}
