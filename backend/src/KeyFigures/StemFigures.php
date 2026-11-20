<?php

namespace App\KeyFigures;

final readonly class StemFigures
{
    /**
     * @param ?SawnTimber   $sawnTimber   null: the stem is not sawn
     * @param ?float        $yield        sawn timber ÷ round wood, 0–1; null if not sawn or one of both is missing
     * @param list<Missing> $yieldMissing what is missing for the yield, empty if there is one or the stem is not sawn
     */
    public function __construct(
        public RoundWood $roundWood,
        public ?SawnTimber $sawnTimber,
        public ?float $yield,
        public array $yieldMissing,
    ) {
    }

    /** The checkmark "sawn", a beam or a cross-section on the stem: decided in KeyFigures::ofStems(). */
    public function isSawn(): bool
    {
        return null !== $this->sawnTimber;
    }
}
