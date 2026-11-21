<?php

namespace App\KeyFigures;

/** The sums behind the dashboard section "Kennzahlen: Sägen", see KeyFigures::totals(). Volumes in fm (round wood) and m³ (sawn timber). */
final readonly class SawingTotals
{
    public function __construct(
        public int $stems,
        public int $sawnStems,
        /** Unsawable and not sawn. */
        public int $unsawableStems,
        /** Processed stems whose round wood cannot be calculated. */
        public int $noRoundWood,
        /** Pieces of sawn stems without a volume. */
        public int $noSawnTimber,
        public float $roundSawn,
        public float $roundUnsawable,
        /** Sawn timber of beams. */
        public float $beams,
        /** Sawn timber of stems sawn whole. */
        public float $wholeStems,
    ) {
    }

    public function processed(): int
    {
        return $this->sawnStems + $this->unsawableStems;
    }

    public function sawnTimber(): float
    {
        return $this->beams + $this->wholeStems;
    }

    /** Sawn timber ÷ round wood of the sawn stems, 0–1; null without round wood. */
    public function yield(): ?float
    {
        return $this->roundSawn > 0 ? $this->sawnTimber() / $this->roundSawn : null;
    }
}
