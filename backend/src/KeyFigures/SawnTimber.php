<?php

namespace App\KeyFigures;

/** Sawn timber of a stem in m³: the sum of its pieces, null as soon as one piece has no volume. */
final readonly class SawnTimber
{
    /** @param list<Piece> $pieces its beams, or the stem itself if sawn whole (then $wholeStem) */
    public function __construct(
        public ?float $volume,
        public array $pieces,
        public bool $wholeStem,
    ) {
    }
}
