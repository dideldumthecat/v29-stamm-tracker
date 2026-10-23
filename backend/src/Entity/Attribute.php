<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * A configurable attribute ("Merkmal"), see Attribute in frontend/src/api/contract.ts.
 * Never deleted, only deactivated: old values must stay displayable.
 */
#[ORM\Entity]
#[ORM\Table(name: 'attributes')]
class Attribute
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    public function __construct(
        #[ORM\Column(length: 255)]
        public string $name,
        #[ORM\Column(length: 16, enumType: AttributeType::class)]
        public AttributeType $type,
        #[ORM\Column(type: 'text')]
        public string $description = '',
        /** Only for type "number". */
        #[ORM\Column(length: 32, nullable: true)]
        public ?string $unit = null,
        #[ORM\Column]
        public bool $isSeries = false,
        #[ORM\Column]
        public bool $isInheritable = false,
        #[ORM\Column]
        public int $sortOrder = 0,
        #[ORM\Column]
        public bool $active = true,
        ?Uuid $id = null,
    ) {
        $this->id = $id ?? Uuid::v7();
    }
}
