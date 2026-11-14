<?php

namespace App\KeyFigures;

/**
 * The one place with the formulas for round wood, sawn timber and yield. The export (TimberReport), the key figures of the
 * detail view and, later, the lists and the dashboard all use it.
 *
 * Two layers: roundWood(), piece() and ofStems() calculate and say what is missing (as Missing, not as text);
 * stemCard() and beamCard() write the texts for the detail view from that result, each right beside its formula.
 * It works on Measures that are already loaded: nothing here asks the database, so one stem or all of them cost the same.
 *
 * Round wood is provisional until V29 confirms the formula: π ÷ 4 × larger diameter × smaller diameter × length, with bark.
 */
final class KeyFigures
{
    // --- Numbers ---------------------------------------------------------------------------------

    /** Ellipse from both diameters; with only one recorded it counts for both (the stem is taken as round). */
    public function roundWood(Measures $stem): RoundWood
    {
        $max = self::known($stem->diameterMax);
        $min = self::known($stem->diameterMin);
        $oneDiameter = (null === $max) !== (null === $min);
        $max ??= $min;
        $min ??= $max;
        $length = self::known($stem->length);
        $missing = array_values(array_filter([null === $max ? Missing::Diameter : null, null === $length ? Missing::Length : null]));

        return new RoundWood([] === $missing ? $max * $min * $length * M_PI / 4 / 10000 : null, $max, $min, $oneDiameter, $length, $missing);
    }

    /** Width × height × length of one beam, or of a stem sawn whole. */
    public function piece(Measures $piece): Piece
    {
        $width = self::known($piece->width);
        $height = self::known($piece->height);
        $length = self::known($piece->length);
        $missing = array_values(array_filter([null === $width || null === $height ? Missing::CrossSection : null, null === $length ? Missing::Length : null]));

        return new Piece($piece->tag, [] === $missing ? $width * $height * $length / 10000 : null, $width, $height, $length, $missing);
    }

    /**
     * The figures of every stem among the items, in one pass.
     *
     * @param list<Measures> $items stems and beams together; a beam whose stem is not among them is ignored
     *
     * @return array<string, StemFigures> by stem id
     */
    public function ofStems(array $items): array
    {
        $beamsOf = [];
        foreach ($items as $item) {
            if (null !== $item->parentId) {
                $beamsOf[$item->parentId][] = $item;
            }
        }

        $figures = [];
        foreach ($items as $stem) {
            if (null !== $stem->parentId) {
                continue;
            }
            $beams = $beamsOf[$stem->id] ?? [];
            usort($beams, static fn (Measures $a, Measures $b) => ($a->tag ?? "\xff") <=> ($b->tag ?? "\xff"));
            // A stem without beams but with a cross-section or the checkmark "sawn" was sawn whole: it is its own piece.
            $whole = [] === $beams && ($stem->crossSectionRecorded || $stem->sawnMarked);
            $sawn = [] === $beams && !$whole ? null : $this->sawnTimber(array_map($this->piece(...), $whole ? [$stem] : $beams), $whole);
            $round = $this->roundWood($stem);
            $yield = null === $sawn || null === $sawn->volume || null === $round->volume ? null : $sawn->volume / $round->volume;
            $yieldMissing = null === $sawn || null !== $yield ? [] : array_values(array_filter([null === $sawn->volume ? Missing::SawnTimber : null, null === $round->volume ? Missing::RoundWood : null]));
            $figures[$stem->id] = new StemFigures($round, $sawn, $yield, $yieldMissing);
        }

        return $figures;
    }

    /** @param list<Piece> $pieces */
    private function sawnTimber(array $pieces, bool $wholeStem): SawnTimber
    {
        $volumes = array_map(static fn (Piece $piece) => $piece->volume, $pieces);

        return new SawnTimber(\in_array(null, $volumes, true) ? null : array_sum($volumes), $pieces, $wholeStem);
    }

    /** 0 means not measured. */
    private static function known(?float $value): ?float
    {
        return null === $value || $value <= 0 ? null : $value;
    }

    // --- Texts for the detail view ----------------------------------------------------------------

    /**
     * Stem: round wood; sawn also sawn timber and yield.
     *
     * @param array<string, string> $names attribute names by key (MeasureReader::names()): the formulas name the attributes they use
     *
     * @return list<KeyFigure>
     */
    public function stemCard(StemFigures $stem, array $names): array
    {
        $round = $stem->roundWood;
        $figures = [new KeyFigure(
            'round_wood', 'Rundholz', $round->volume, 'm³',
            match (true) {
                null === $round->volume => self::lacks($round->missing),
                $round->oneDiameter => \sprintf('aus einem Durchmesser (%s cm) und %s m', self::cm($round->diameterMax), self::meters($round->length)),
                default => \sprintf('aus %s × %s cm und %s m', self::cm($round->diameterMax), self::cm($round->diameterMin), self::meters($round->length)),
            },
            \sprintf('π ÷ 4 × %s × %s × %s', $names['mid_diameter_max'], $names['mid_diameter_min'], $names['length']),
            null === $round->volume ? null : \sprintf('%s × %s m × %s m × %s m', self::number(M_PI / 4, 3), self::meters($round->diameterMax / 100), self::meters($round->diameterMin / 100), self::meters($round->length)),
            'Vorläufige Formel: Durchmesser mit Rinde, kein Abzug.'.($round->oneDiameter ? ' Nur ein Durchmesser erfasst: Der Stamm wird als kreisrund gerechnet.' : ''),
        )];
        if (null === $sawn = $stem->sawnTimber) {
            return $figures;
        }

        $whole = $sawn->wholeStem ? $sawn->pieces[0] : null;
        $figures[] = new KeyFigure(
            'sawn_timber', 'Schnittholz', $sawn->volume, 'm³',
            match (true) {
                null !== $whole && null !== $sawn->volume => 'Stamm als Ganzes gesägt, '.self::pieceInputs($whole),
                null !== $whole => self::lacks($whole->missing),
                null === $sawn->volume => self::lacksOnBeams($sawn->pieces),
                1 === \count($sawn->pieces) => 'ein Balken',
                default => \sprintf('Summe der %d Balken', \count($sawn->pieces)),
            },
            null !== $whole ? self::pieceFormula($names) : 'Summe des Schnittholzes aller Balken',
            match (true) {
                null === $sawn->volume => null,
                null !== $whole => self::pieceInserted($whole),
                default => implode(' + ', array_map(static fn (Piece $piece) => self::number($piece->volume, 3), $sawn->pieces)).' m³',
            },
            null,
        );
        $figures[] = new KeyFigure(
            'yield', 'Ausbeute', $stem->yield, '%',
            null === $stem->yield ? self::lacks($stem->yieldMissing) : 'Schnittholz ÷ Rundholz',
            'Schnittholz ÷ Rundholz',
            null === $stem->yield ? null : \sprintf('%s m³ ÷ %s m³', self::number($sawn->volume, 3), self::number($round->volume, 3)),
            null,
        );

        return $figures;
    }

    /**
     * Beam: only its own volume.
     *
     * @param array<string, string> $names
     *
     * @return list<KeyFigure>
     */
    public function beamCard(Piece $piece, array $names): array
    {
        return [new KeyFigure(
            'sawn_timber', 'Schnittholz', $piece->volume, 'm³',
            null === $piece->volume ? self::lacks($piece->missing) : 'aus '.self::pieceInputs($piece),
            self::pieceFormula($names),
            null === $piece->volume ? null : self::pieceInserted($piece),
            null,
        )];
    }

    /** @param array<string, string> $names */
    private static function pieceFormula(array $names): string
    {
        return 'Breite × Höhe × '.$names['length'];
    }

    private static function pieceInputs(Piece $piece): string
    {
        return \sprintf('%s × %s cm und %s m', self::cm($piece->width), self::cm($piece->height), self::meters($piece->length));
    }

    private static function pieceInserted(Piece $piece): string
    {
        return \sprintf('%s m × %s m × %s m', self::meters($piece->width / 100), self::meters($piece->height / 100), self::meters($piece->length));
    }

    /**
     * "Querschnitt fehlt an Balken B, C; Länge fehlt an Balken C".
     *
     * @param list<Piece> $pieces
     */
    private static function lacksOnBeams(array $pieces): string
    {
        $parts = [];
        foreach ([Missing::CrossSection, Missing::Length] as $what) {
            $labels = [];
            foreach ($pieces as $piece) {
                if (\in_array($what, $piece->missing, true)) {
                    $labels[] = self::beamLabel($piece->tag);
                }
            }
            if ([] !== $labels) {
                $parts[] = \sprintf('%s fehlt an Balken %s', self::word($what), implode(', ', $labels));
            }
        }

        return implode('; ', $parts);
    }

    /** The letter of "104-B"; an unusual or missing tag as it is. */
    private static function beamLabel(?string $tag): string
    {
        return null === $tag ? 'ohne Kennung' : (preg_match('/-([A-Za-z]+)$/', $tag, $match) ? strtoupper($match[1]) : $tag);
    }

    /** @param list<Missing> $missing */
    private static function lacks(array $missing): string
    {
        $words = array_map(self::word(...), $missing);

        return implode(' und ', $words).(\count($words) > 1 ? ' fehlen' : ' fehlt');
    }

    private static function word(Missing $missing): string
    {
        return match ($missing) {
            Missing::Diameter => 'Durchmesser',
            Missing::Length => 'Länge',
            Missing::CrossSection => 'Querschnitt',
            Missing::SawnTimber => 'Schnittholz',
            Missing::RoundWood => 'Rundholz',
        };
    }

    private static function number(float $value, int $decimals): string
    {
        return number_format($value, $decimals, ',', '');
    }

    /** "40", "14,7": centimetres as recorded, without trailing zeros. */
    private static function cm(float $value): string
    {
        return rtrim(rtrim(self::number($value, 2), '0'), ',');
    }

    /** "4,10", "0,40", "0,147": metres with two decimals, a third only where needed. */
    private static function meters(float $value): string
    {
        $text = self::number($value, 3);

        return str_ends_with($text, '0') ? substr($text, 0, -1) : $text;
    }
}
