<?php

namespace App\KeyFigures;

/** Round wood of a stem in m³. The diameters are the ones the volume uses: with only one recorded, both hold it. */
final readonly class RoundWood
{
    /** @param list<Missing> $missing */
    public function __construct(
        public ?float $volume,
        public ?float $diameterMax,
        public ?float $diameterMin,
        public bool $oneDiameter,
        public ?float $length,
        public array $missing,
    ) {
    }
}
