<?php

namespace App\KeyFigures;

/** KeyFigure in frontend/shared/contract.ts: a figure with the texts that explain it. */
final readonly class KeyFigure
{
    public function __construct(
        /** diameter_class | round_wood | sawn_timber | yield */
        public string $key,
        public string $label,
        /** m³, the share 0–1 for the yield, or from_cm of the class (cm); null: not calculable. */
        public ?float $value,
        public string $unit,
        public string $source,
        public string $formula,
        public ?string $inserted,
        public ?string $note,
    ) {
    }
}
