<?php

namespace App\KeyFigures;

/** DashboardFigure in frontend/shared/contract.ts: a total with the texts that explain it. */
final readonly class DashboardFigure
{
    public function __construct(
        public string $key,
        public string $label,
        /** fm or m³, the share 0–1 for a yield, otherwise a count; null: not calculable. */
        public int|float|null $value,
        /** fm | m³ | % ; null: a count */
        public ?string $unit,
        public string $formula,
        public ?string $inserted,
        public ?string $note,
    ) {
    }
}
