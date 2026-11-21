<?php

namespace App\KeyFigures;

/**
 * What the figures need to know about one stem or beam, read from its effective values (see MeasureReader).
 * Diameters, width and height in cm, length in m. null: not recorded or not readable; 0 counts as not measured, KeyFigures decides.
 */
final readonly class Measures
{
    public function __construct(
        public string $id,
        public ?string $parentId,
        /** "123" or "123-A". */
        public ?string $tag,
        public ?float $diameterMax,
        public ?float $diameterMin,
        public ?float $length,
        public ?float $width,
        public ?float $height,
        public bool $crossSectionRecorded,
        public bool $sawnMarked,
        public bool $unsawableMarked = false,
        /** Stems: the option of the attribute "source" (the pile); null if none recorded or the attribute does not exist. */
        public ?string $pileId = null,
        /** Device time the item was created. */
        public ?\DateTimeImmutable $createdAt = null,
        /** Stems: device time "sawn" was first recorded as yes, without one the time the cross-section was recorded; null if neither. */
        public ?\DateTimeImmutable $sawnAt = null,
    ) {
    }
}
