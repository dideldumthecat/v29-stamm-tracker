<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;

/**
 * Master data of a pile ("Polter") from the handover record of the forestry office. A pile is an option of the attribute with the key "source";
 * the value recorded on a timber item stays the option id. The row is created with the first save in the administration, so an option
 * without a row is a pile without master data (it has no number yet).
 *
 * The decimal columns are strings in PHP (Doctrine's mapping), the administration sees numbers (see AdminPile in frontend/shared/contract.ts).
 */
#[ORM\Entity]
#[ORM\Table(name: 'piles')]
class Pile
{
    public function __construct(
        #[ORM\Id]
        #[ORM\OneToOne]
        #[ORM\JoinColumn(name: 'option_id')]
        public readonly AttributeOption $option,
        /** The forester's pile number, free text. */
        #[ORM\Column(length: 32, unique: true)]
        public string $number,
        /** Storage place per forester. */
        #[ORM\Column(length: 200, nullable: true)]
        public ?string $location = null,
        #[ORM\Column(type: Types::DECIMAL, precision: 9, scale: 6, nullable: true)]
        public ?string $latitude = null,
        #[ORM\Column(type: Types::DECIMAL, precision: 9, scale: 6, nullable: true)]
        public ?string $longitude = null,
        /** Raummeter. */
        #[ORM\Column(type: Types::DECIMAL, precision: 8, scale: 2, nullable: true)]
        public ?string $stackedVolume = null,
    ) {
    }
}
