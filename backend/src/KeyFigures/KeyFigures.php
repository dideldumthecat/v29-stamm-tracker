<?php

namespace App\KeyFigures;

/**
 * The one place with the formulas for round wood, sawn timber and yield. The export (TimberReport), the key figures of the
 * detail view, the dashboard and, later, the lists all use it.
 *
 * Two layers: roundWood(), piece() and ofStems() calculate and say what is missing (as Missing, not as text);
 * stemCard() and beamCard() write the texts for the detail view from that result, each right beside its formula;
 * totals() adds the results up for the dashboard (DashboardCards writes its texts) and the pile cards.
 * It works on Measures that are already loaded: nothing here asks the database, so one stem or all of them cost the same.
 *
 * Round wood is provisional until V29 confirms the formula: π ÷ 4 × larger diameter × smaller diameter × length, with bark.
 */
final class KeyFigures
{
    /** Wanted format 14×14 is large, 10×14 small: the shorter side in cm decides. */
    public const LARGE_BEAM_MIN_SIDE_CM = 12;
    public const LARGE_BEAM_LABEL = '14×14 (groß)';
    public const SMALL_BEAM_LABEL = '10×14 (klein)';
    public const PRELIMINARY = 'Vorläufige Formel: Durchmesser mit Rinde, kein Abzug.';

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
        $pieces = new StemPieces($items);
        $figures = [];
        foreach ($pieces->stems() as $stem) {
            $sawn = $pieces->isSawn($stem->id)
                ? $this->sawnTimber(array_map($this->piece(...), $pieces->piecesOf($stem->id)), $pieces->isSawnWhole($stem->id))
                : null;
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

    /** "large" from a shorter side of 12 cm on, otherwise "small"; null without a readable cross-section. */
    public static function beamSize(Piece $piece): ?string
    {
        return null === $piece->width || null === $piece->height ? null : (min($piece->width, $piece->height) >= self::LARGE_BEAM_MIN_SIDE_CM ? 'large' : 'small');
    }

    /** 0 means not measured. */
    private static function known(?float $value): ?float
    {
        return null === $value || $value <= 0 ? null : $value;
    }

    // --- Texts for the detail view ----------------------------------------------------------------

    /**
     * Stem: round wood; sawn also sawn timber and yield; at the end the diameter class, which every stem has.
     *
     * @param array<string, string> $names attribute names by key (MeasureReader::names()): the formulas name the attributes they use
     *
     * @return list<KeyFigure>
     */
    public function stemCard(StemFigures $stem, array $names): array
    {
        $round = $stem->roundWood;
        $figures = [new KeyFigure(
            'round_wood', 'Rundholz', $round->volume, 'fm',
            match (true) {
                null === $round->volume => self::lacks($round->missing),
                $round->oneDiameter => \sprintf('aus einem Durchmesser (%s cm) und %s m', self::cm($round->diameterMax), self::meters($round->length)),
                default => \sprintf('aus %s × %s cm und %s m', self::cm($round->diameterMax), self::cm($round->diameterMin), self::meters($round->length)),
            },
            self::roundWoodFormula($names),
            null === $round->volume ? null : \sprintf('%s × %s m × %s m × %s m', self::number(M_PI / 4, 3), self::meters($round->diameterMax / 100), self::meters($round->diameterMin / 100), self::meters($round->length)),
            self::PRELIMINARY.($round->oneDiameter ? ' Nur ein Durchmesser erfasst: Der Stamm wird als kreisrund gerechnet.' : ''),
        )];
        $diameterClass = $this->diameterClassCard($round, $names);
        if (null === $sawn = $stem->sawnTimber) {
            return [...$figures, $diameterClass];
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
            null === $stem->yield ? null : \sprintf('%s m³ ÷ %s fm', self::number($sawn->volume, 3), self::number($round->volume, 3)),
            null,
        );

        return [...$figures, $diameterClass];
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

    // --- Totals for the dashboard and the pile cards ------------------------------------------------------------------

    /**
     * The sums of the dashboard and the pile cards: a stem is processed if it is sawn (StemFigures::isSawn()) or unsawable. Round wood adds up processed stems,
     * sawn timber every piece of sawn stems (beams, or the stem sawn whole). Items without a calculable volume are left out of a sum and counted.
     *
     * @param list<Measures>             $items   all stems and beams that are not voided
     * @param array<string, StemFigures> $figures ofStems() of these items
     */
    public function totals(array $items, array $figures): SawingTotals
    {
        $stems = $sawnStems = $unsawableStems = $noRoundWood = $noSawnTimber = 0;
        $roundSawn = $roundUnsawable = $beams = $wholeStems = 0.0;
        foreach ($items as $stem) {
            if (null !== $stem->parentId) {
                continue;
            }
            ++$stems;
            $sawnTimber = $figures[$stem->id]->sawnTimber;
            // A stem both sawn and unsawable (hidden_when, not enforced by the server) counts as sawn.
            $sawn = $figures[$stem->id]->isSawn();
            if (!$sawn && !$stem->unsawableMarked) {
                continue;
            }
            $sawn ? ++$sawnStems : ++$unsawableStems;
            foreach ($sawnTimber->pieces ?? [] as $piece) {
                if (null === $piece->volume) {
                    ++$noSawnTimber;
                } elseif ($sawnTimber->wholeStem) {
                    $wholeStems += $piece->volume;
                } else {
                    $beams += $piece->volume;
                }
            }
            $round = $figures[$stem->id]->roundWood->volume;
            if (null === $round) {
                ++$noRoundWood;
            } elseif ($sawn) {
                $roundSawn += $round;
            } else {
                $roundUnsawable += $round;
            }
        }

        return new SawingTotals($stems, $sawnStems, $unsawableStems, $noRoundWood, $noSawnTimber, $roundSawn, $roundUnsawable, $beams, $wholeStems);
    }

    /**
     * The section "Stämme nach Mittendurchmesser": processed stems (as in totals()) in classes of two whole cm (32 and 33 cm: from_cm 32, to_cm 34).
     * The class diameter is the mean of both diameters rounded commercially to whole cm (half up: 32.5 → 33, V29's choice, not the forestry convention of rounding down), or the one recorded (RoundWood holds it twice then).
     * Classes run from the smallest to the largest one with a stem, empty ones in between included. Yield and beams per stem count
     * sawn stems only, missing volumes are left out as in totals(); a stem sawn whole is one beam.
     * Beams are large or small by the shorter side of their cross-section; one without a readable cross-section counts in neither.
     *
     * @param list<Measures>        $items all stems and beams that are not voided
     * @param array<string, string> $names attribute names by key, with sawn_cross_section
     *
     * @return array{notes: list<array{term: string, text: string}>, rows: list<array{from_cm: int, to_cm: int, stems: int, not_sawable: int, yield: ?float, beams_per_stem_large: int|float|null, beams_per_stem_small: int|float|null}>, without_diameter: int}
     */
    public function diameterClasses(array $items, array $names): array
    {
        $figures = $this->ofStems($items);
        $empty = ['stems' => 0, 'not_sawable' => 0, 'sawn' => 0, 'large' => 0, 'small' => 0, 'sawn_timber' => 0.0, 'round_wood' => 0.0];
        $classes = [];
        $withoutDiameter = 0;
        foreach ($items as $stem) {
            if (null !== $stem->parentId) {
                continue;
            }
            $stemFigures = $figures[$stem->id];
            $sawn = $stemFigures->isSawn();
            if (!$sawn && !$stem->unsawableMarked) {
                continue;
            }
            $round = $stemFigures->roundWood;
            if (null === $mean = self::meanDiameter($round)) {
                ++$withoutDiameter;
                continue;
            }
            $from = self::diameterClass($mean);
            $classes[$from] ??= $empty;
            ++$classes[$from]['stems'];
            if (!$sawn) {
                ++$classes[$from]['not_sawable'];
                continue;
            }
            ++$classes[$from]['sawn'];
            foreach ($stemFigures->sawnTimber->pieces as $piece) {
                $classes[$from]['sawn_timber'] += $piece->volume ?? 0.0;
                if (null !== $size = self::beamSize($piece)) {
                    ++$classes[$from][$size];
                }
            }
            $classes[$from]['round_wood'] += $round->volume ?? 0.0;
        }

        $rows = [];
        if ([] !== $classes) {
            for ($from = min(array_keys($classes)); $from <= max(array_keys($classes)); $from += 2) {
                $class = $classes[$from] ?? $empty;
                $rows[] = [
                    'from_cm' => $from,
                    'to_cm' => $from + 2,
                    'stems' => $class['stems'],
                    'not_sawable' => $class['not_sawable'],
                    'yield' => $class['round_wood'] > 0 ? $class['sawn_timber'] / $class['round_wood'] : null,
                    'beams_per_stem_large' => $class['sawn'] > 0 ? $class['large'] / $class['sawn'] : null,
                    'beams_per_stem_small' => $class['sawn'] > 0 ? $class['small'] / $class['sawn'] : null,
                ];
            }
        }

        return [
            'notes' => [
                ['term' => 'Stämme', 'text' => 'Alle bearbeiteten Stämme, also gesägt oder nicht sägbar.'],
                ['term' => 'Durchmesser', 'text' => self::diameterRule($names)],
                ['term' => 'Klassen', 'text' => 'je 2 cm, z. B. 32–33 cm = 32 und 33 cm.'],
                ['term' => 'Ausbeute', 'text' => 'Schnittholz ÷ Rundholz der gesägten Stämme der Klasse. Der Rest ist Verschnitt: Rinde, Schwarten, Späne.'],
                ['term' => 'Balken je Stamm', 'text' => 'Große bzw. kleine Balken ÷ gesägte Stämme der Klasse. Ein als Ganzes gesägter Stamm zählt als 1 Balken.'],
                ['term' => 'Groß und klein', 'text' => \sprintf('Grundlage ist %s: Ist die kleinere Seite mindestens %d cm, ist der Balken groß (z. B. 14×14), sonst klein (z. B. 10×14). Ein Balken ohne lesbaren Querschnitt zählt weder als groß noch als klein.', $names['sawn_cross_section'], self::LARGE_BEAM_MIN_SIDE_CM)],
                ['term' => 'Nicht sägbar', 'text' => 'zählt nur bei der Anzahl der Stämme (in Klammern dahinter), nicht bei Ausbeute und Balken je Stamm.'],
            ],
            'rows' => $rows,
            'without_diameter' => $withoutDiameter,
        ];
    }

    // --- The class of a stem by its mean diameter -------------------------------------------------------

    /** The mean of both diameters (with only one recorded, RoundWood holds it twice); null without a diameter. */
    public static function meanDiameter(RoundWood $round): ?float
    {
        return null === $round->diameterMax || null === $round->diameterMin ? null : ($round->diameterMax + $round->diameterMin) / 2;
    }

    /** The mean in whole cm, rounded commercially (half up: 32.5 → 33, V29's choice, not the forestry convention of rounding down). */
    public static function wholeCm(float $mean): int
    {
        // Rounded to 6 places first, so that float noise does not turn 32.5 into 32.4999…; PHP's round() is half up
        return (int) round(round($mean, 6));
    }

    /**
     * The one rule for the class of a stem: classes of two whole cm, 32 and 33 cm are from_cm 32 (to_cm 34).
     * The dashboard section and the key figure use it; the list of stems has its copy in frontend/shared/attributes.ts (diameterClassOf), tested with the same cases.
     */
    public static function diameterClass(float $mean): int
    {
        return intdiv(self::wholeCm($mean), 2) * 2;
    }

    /** @param array<string, string> $names */
    public static function diameterRule(array $names): string
    {
        return \sprintf('(%s + %s) ÷ 2, auf ganze cm kaufmännisch gerundet (ab ,5 aufgerundet). Ist nur einer erfasst, zählt dieser.', $names['mid_diameter_max'], $names['mid_diameter_min']);
    }

    /** @param array<string, string> $names */
    private function diameterClassCard(RoundWood $round, array $names): KeyFigure
    {
        $mean = self::meanDiameter($round);

        return new KeyFigure(
            'diameter_class', 'Mittendurchmesser', null === $mean ? null : (float) self::diameterClass($mean), 'cm',
            match (true) {
                null === $mean => self::lacks([Missing::Diameter]),
                $round->oneDiameter => \sprintf('aus einem Durchmesser (%s cm)', self::cm($round->diameterMax)),
                default => \sprintf('aus %s × %s cm', self::cm($round->diameterMax), self::cm($round->diameterMin)),
            },
            self::diameterRule($names),
            null === $mean ? null : \sprintf(
                '%s%s ≈ %d cm',
                $round->oneDiameter ? '' : \sprintf('(%s + %s) ÷ 2 = ', self::cm($round->diameterMax), self::cm($round->diameterMin)),
                self::cm($mean),
                self::wholeCm($mean),
            ),
            null,
        );
    }

    /** " 3 bearbeitete Stämme ohne Durchmesser oder Länge fehlen in der Summe."; empty if none. */
    public static function leftOut(int $count, string $one, string $many, string $what): string
    {
        return match ($count) {
            0 => '',
            1 => " 1 $one ohne $what fehlt in der Summe.",
            default => " $count $many ohne $what fehlen in der Summe.",
        };
    }

    /** @param array<string, string> $names */
    public static function roundWoodFormula(array $names): string
    {
        return \sprintf('π ÷ 4 × %s × %s × %s', $names['mid_diameter_max'], $names['mid_diameter_min'], $names['length']);
    }

    /** @param array<string, string> $names */
    public static function pieceFormula(array $names): string
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
