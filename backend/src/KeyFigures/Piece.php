<?php

namespace App\KeyFigures;

/** One piece of sawn timber (a beam, or a stem sawn whole) with its volume in m³. */
final readonly class Piece
{
    /** @param list<Missing> $missing */
    public function __construct(
        public ?string $tag,
        public ?float $volume,
        public ?float $width,
        public ?float $height,
        public ?float $length,
        public array $missing,
    ) {
    }
}
