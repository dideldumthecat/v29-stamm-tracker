<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * Option of a "choice" attribute. Never deleted, only deactivated.
 */
#[ORM\Entity]
#[ORM\Table(name: 'attribute_options')]
class AttributeOption
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    public function __construct(
        #[ORM\ManyToOne]
        #[ORM\JoinColumn(name: 'attribute_id', nullable: false)]
        public Attribute $attribute,
        #[ORM\Column(length: 255)]
        public string $label,
        #[ORM\Column]
        public int $sortOrder = 0,
        #[ORM\Column]
        public bool $active = true,
        ?Uuid $id = null,
    ) {
        $this->id = $id ?? Uuid::v7();
    }
}
