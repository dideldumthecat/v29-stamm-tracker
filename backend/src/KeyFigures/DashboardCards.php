<?php

namespace App\KeyFigures;

/**
 * The card sections "Rundholz" and "Schnittholz" of the dashboard (DashboardCardsSection in frontend/shared/contract.ts).
 * Counts, volumes and yield are those of KeyFigures::totals(); new here are the Raummeter (Rm) of the piles shared out per stem,
 * the week a stem was processed, the tempo and the forecast. The cards are display only: the server formats every text (de-DE).
 * Nothing here asks the database.
 */
final class DashboardCards
{
    private const TIMEZONE = 'Europe/Berlin';
    /** The tempo is the mean of at most this many completed weeks. */
    private const TEMPO_WEEKS = 4;
    private const NONE = '–';

    public function __construct(private readonly KeyFigures $figures)
    {
    }

    /**
     * @param list<Measures>             $items all stems and beams that are not voided
     * @param list<array<string, mixed>> $piles PileEditor::all(): the options of the attribute "source" with their master data
     * @param array<string, string>      $names attribute names by key, with unsawable
     * @param \DateTimeImmutable         $now   decides the current week and the start of the forecast
     *
     * @return list<array<string, mixed>> the sections "round_wood" and "sawn_timber"
     *
     * @throws \RuntimeException without the attribute "unsawable"
     */
    public function build(array $items, array $piles, array $names, \DateTimeImmutable $now): array
    {
        $unsawableName = $names['unsawable'] ?? throw new \RuntimeException('The dashboard needs the attribute with the key unsawable.');
        $pieces = new StemPieces($items);
        $figures = $this->figures->ofStems($items);
        $totals = $this->figures->totals($items, $figures);
        $volumes = self::stackedVolumes($pieces->stems(), $piles);

        $processed = [];
        foreach ($pieces->stems() as $stem) {
            if ($figures[$stem->id]->isSawn() || $stem->unsawableMarked) {
                $processed[$stem->id] = $stem;
            }
        }
        $rm = static fn (iterable $stems): float => array_sum(array_map(static fn (Measures $stem) => $volumes['share'][$stem->id] ?? 0.0, [...$stems]));
        $open = $totals->stems - $totals->processed();
        $openRm = $rm(array_filter($pieces->stems(), static fn (Measures $stem) => !isset($processed[$stem->id])));
        $tempo = self::tempo($processed, $pieces, $volumes['share'], $now);

        // "gesägt", "nicht sägbar": the states in the short form of the sums, named as in the database
        $sawnState = mb_strtolower($names['sawn']);
        $unsawableState = mb_strtolower($unsawableName);
        $sawnRule = \sprintf('Als gesägt zählt ein Stamm, wenn %s angehakt ist, Balken vorhanden sind oder %s erfasst ist.', $names['sawn'], $names['sawn_cross_section']);
        $rmRule = 'Raummeter (Rm) anteilig: Jeder Stamm trägt die Raummeter seines Polters ÷ Stämme des Polters bei.';
        $rmLeftOut = self::rmLeftOut($volumes['piles_without_rm'], $volumes['stems_on_them'], $volumes['stems_without_pile']);
        $roundSawn = $totals->roundSawn;
        $roundUnsawable = $totals->roundUnsawable;

        $roundWood = [
            self::card('stems_total', 'Gepoltert', self::count($totals->stems), self::stems($totals->stems), self::decimal(array_sum($volumes['stacked']), 2).' Rm',
                'Alle Stämme ohne Balken, entfernte nicht mitgezählt. Rm: Summe der Raummeter aller Polter mit mindestens einem Stamm.',
                [] === $volumes['stacked'] ? null : implode(' + ', array_map(static fn (float $volume) => self::decimal($volume, 2), $volumes['stacked'])).' Rm',
                $rmLeftOut),
            self::card('stems_processed', 'Bearbeitet', self::count($totals->processed()), self::stems($totals->processed()),
                ($totals->stems > 0 ? self::percent($totals->processed() / $totals->stems).' % ' : '').'≈ '.self::decimal($rm($processed), 2).' Rm',
                \sprintf('%s Bearbeitet sind außerdem Stämme mit Häkchen bei %s. Anteil: Bearbeitet ÷ Gepoltert. %s Rm bearbeitet ist die Summe über die bearbeiteten Stämme.', $sawnRule, $unsawableName, $rmRule),
                \sprintf('%d %s + %d %s; %d ÷ %d Stämme', $totals->sawnStems, $sawnState, $totals->unsawableStems, $unsawableState, $totals->processed(), $totals->stems),
                $rmLeftOut),
            self::card('stems_unsawable', $unsawableName, self::count($totals->unsawableStems), self::stems($totals->unsawableStems),
                $totals->processed() > 0 ? self::percent($totals->unsawableStems / $totals->processed()).' % der bearbeiteten' : null,
                \sprintf('Stämme mit Häkchen bei %s, die nicht gesägt sind. Anteil: %s ÷ Bearbeitet.', $unsawableName, $unsawableName),
                $totals->processed() > 0 ? \sprintf('%d ÷ %d Stämme', $totals->unsawableStems, $totals->processed()) : null,
                null),
            self::card('round_wood', 'Rundholz bearbeitet', self::decimal($roundSawn + $roundUnsawable, 2), 'fm',
                $totals->processed().(1 === $totals->processed() ? ' bearbeiteter Stamm' : ' bearbeitete Stämme'),
                \sprintf('Summe über alle bearbeiteten Stämme, je Stamm %s', KeyFigures::roundWoodFormula($names)),
                \sprintf('%s fm %s + %s fm %s', self::decimal($roundSawn, 2), $sawnState, self::decimal($roundUnsawable, 2), $unsawableState),
                KeyFigures::PRELIMINARY.KeyFigures::leftOut($totals->noRoundWood, 'bearbeiteter Stamm', 'bearbeitete Stämme', 'Durchmesser oder Länge')),
            self::card('tempo', 'Tempo', null === $tempo ? self::NONE : self::decimal($tempo['stems'], 1), null === $tempo ? null : 'Stämme / Woche',
                null === $tempo ? null : '≈ '.self::decimal($tempo['rm'], 2).' Rm / Woche',
                \sprintf('Bearbeitete Stämme der letzten %d abgeschlossenen Kalenderwochen ÷ %d, die aktuelle Woche zählt nicht. Gibt es seit der ersten Bearbeitung weniger abgeschlossene Wochen, dann über diese. Rm pro Woche: die anteiligen Rm derselben Stämme ÷ dieselben Wochen.', self::TEMPO_WEEKS, self::TEMPO_WEEKS),
                null === $tempo ? null : \sprintf('%d %s ÷ %s; %s Rm ÷ %s', $tempo['processed'], self::stems($tempo['processed']), $tempo['weeks'], self::decimal($tempo['processed_rm'], 2), $tempo['weeks']),
                \sprintf('Ein Stamm zählt in der Kalenderwoche (Montag bis Sonntag, Zeitzone Europe/Berlin), in der %s oder %s zum ersten Mal auf Ja gesetzt wurde; sonst in der Woche, in der sein erster Balken angelegt bzw. %s erfasst wurde. Ein Datum nach der aktuellen Woche zählt in der aktuellen. Ohne abgeschlossene Woche gibt es kein Tempo. %s%s',
                    $names['sawn'], $unsawableName, $names['sawn_cross_section'], $rmRule, $rmLeftOut ? ' '.$rmLeftOut : ''),
                startsRow: true),
            self::card('supply', 'Vorrat reicht bis ca.', self::supplyWeek($open, $tempo['stems'] ?? null, $now), null,
                \sprintf('%s %s ≈ %s Rm offen', self::count($open), self::stems($open), self::decimal($openRm, 2)),
                'Heute + offene Stämme ÷ Tempo in Wochen, davon die Kalenderwoche. Offen: Gepoltert − Bearbeitet.',
                null === $tempo || $tempo['stems'] <= 0 ? null : \sprintf('%d %s ÷ %s Stämme / Woche ≈ %s Wochen ab %s', $open, self::stems($open), self::decimal($tempo['stems'], 1), self::decimal($open / $tempo['stems'], 1), $now->setTimezone(new \DateTimeZone(self::TIMEZONE))->format('d.m.Y')),
                'Eine Hochrechnung aus dem bisherigen Tempo: Bleibt es so, sind die offenen Stämme etwa in dieser Woche bearbeitet. Ohne Tempo keine Hochrechnung. '.$rmRule.($rmLeftOut ? ' '.$rmLeftOut : ''),
                highlight: true),
        ];

        return [
            ['type' => 'cards', 'key' => 'round_wood', 'label' => 'Rundholz', 'description' => 'In Stämmen und Raummetern (Rm)', 'cards' => $roundWood],
            ['type' => 'cards', 'key' => 'sawn_timber', 'label' => 'Schnittholz', 'description' => 'In Balken', 'cards' => $this->sawnTimber($pieces, $figures, $totals, $names, $sawnRule, $unsawableName)],
        ];
    }

    /**
     * @param array<string, StemFigures> $figures
     * @param array<string, string>      $names
     *
     * @return list<array<string, mixed>>
     */
    private function sawnTimber(StemPieces $pieces, array $figures, SawingTotals $totals, array $names, string $sawnRule, string $unsawableName): array
    {
        $beams = $whole = $unreadable = 0;
        $sizes = ['large' => 0, 'small' => 0];
        foreach ($pieces->stems() as $stem) {
            $sawn = $figures[$stem->id]->sawnTimber;
            foreach ($sawn->pieces ?? [] as $piece) {
                $sawn->wholeStem ? ++$whole : ++$beams;
                null === ($size = KeyFigures::beamSize($piece)) ? ++$unreadable : ++$sizes[$size];
            }
        }
        $all = $beams + $whole;
        $sizeRule = \sprintf('Grundlage ist %s: Ist die kleinere Seite mindestens %d cm, ist der Balken %s, sonst %s. Ein als Ganzes gesägter Stamm zählt als 1 Balken.', $names['sawn_cross_section'], KeyFigures::LARGE_BEAM_MIN_SIDE_CM, KeyFigures::LARGE_BEAM_LABEL, KeyFigures::SMALL_BEAM_LABEL);
        $unreadableNote = match ($unreadable) {
            0 => null,
            1 => '1 Balken ohne lesbaren Querschnitt zählt weder als groß noch als klein.',
            default => "$unreadable Balken ohne lesbaren Querschnitt zählen weder als groß noch als klein.",
        };
        $size = static fn (string $key, string $label, string $marker, int $count) => self::card($key, $label, self::count($count), 'Balken',
            $all > 0 ? self::percent($count / $all, 0).' % der Balken' : null,
            \sprintf('%s Anteil: %s ÷ Gesägt gesamt.', $sizeRule, $label),
            $all > 0 ? \sprintf('%d ÷ %d Balken', $count, $all) : null,
            $unreadableNote, $marker);
        $roundSawn = $totals->roundSawn;
        $sawnTimber = $totals->sawnTimber();
        $yield = $totals->yield();

        return [
            self::card('beams_total', 'Gesägt gesamt', self::count($all), 'Balken',
                \sprintf('%s m³ · aus %s', self::decimal($sawnTimber, 2), 1 === $totals->sawnStems ? '1 Stamm' : self::count($totals->sawnStems).' Stämmen'),
                \sprintf('Balken: alle Balken gesägter Stämme, ein als Ganzes gesägter Stamm zählt als 1 Balken. m³: Summe über alle Stücke gesägter Stämme, je Stück %s. %s', KeyFigures::pieceFormula($names), $sawnRule),
                \sprintf('%d Balken + %d als Ganzes gesägte Stämme; %s m³ Balken + %s m³ als Ganzes gesägte Stämme', $beams, $whole, self::decimal($totals->beams, 2), self::decimal($totals->wholeStems, 2)),
                ltrim(KeyFigures::leftOut($totals->noSawnTimber, 'Stück', 'Stücke', 'Querschnitt oder Länge')) ?: null),
            $size('beams_large', KeyFigures::LARGE_BEAM_LABEL, 'large', $sizes['large']),
            $size('beams_small', KeyFigures::SMALL_BEAM_LABEL, 'small', $sizes['small']),
            self::card('yield', 'Ausbeute', null === $yield ? self::NONE : self::percent($yield), null === $yield ? null : '%',
                1 === $totals->sawnStems ? '1 gesägter Stamm' : self::count($totals->sawnStems).' gesägte Stämme',
                'Schnittholz ÷ Rundholz der gesägten Stämme',
                $roundSawn > 0 ? \sprintf('%s m³ ÷ %s fm', self::decimal($sawnTimber, 2), self::decimal($roundSawn, 2)) : null,
                \sprintf('Nur gesägte Stämme gehen ein. %s Stämme mit Häkchen bei %s zählen nicht.', $sawnRule, $unsawableName)),
        ];
    }

    /**
     * The Rm of every pile shared out over its stems.
     *
     * @param list<Measures>             $stems
     * @param list<array<string, mixed>> $piles
     *
     * @return array{share: array<string, float>, stacked: list<float>, piles_without_rm: int, stems_on_them: int, stems_without_pile: int}
     *                                                                                                                                      share by stem id (only stems on a pile with Rm), the Rm of every pile with a stem
     */
    private static function stackedVolumes(array $stems, array $piles): array
    {
        $volumeOf = array_column($piles, 'stacked_volume', 'id');
        $stemsOf = [];
        $withoutPile = 0;
        foreach ($stems as $stem) {
            if (null === $stem->pileId || !\array_key_exists($stem->pileId, $volumeOf)) {
                ++$withoutPile;
            } else {
                $stemsOf[$stem->pileId][] = $stem->id;
            }
        }
        $share = [];
        $stacked = [];
        $pilesWithoutRm = $stemsOnThem = 0;
        foreach ($stemsOf as $pileId => $ids) {
            $volume = $volumeOf[$pileId];
            if (null === $volume) {
                ++$pilesWithoutRm;
                $stemsOnThem += \count($ids);
                continue;
            }
            $stacked[] = (float) $volume;
            foreach ($ids as $id) {
                $share[$id] = $volume / \count($ids);
            }
        }

        return ['share' => $share, 'stacked' => $stacked, 'piles_without_rm' => $pilesWithoutRm, 'stems_on_them' => $stemsOnThem, 'stems_without_pile' => $withoutPile];
    }

    /**
     * When a processed stem was processed: "sawn" or "unsawable" first set to yes, whichever came first; without either the cross-section
     * of the stem (both in Measures) or else its first beam.
     */
    private static function processedAt(Measures $stem, StemPieces $pieces): ?\DateTimeImmutable
    {
        $times = array_filter([$stem->sawnAt, $stem->unsawableAt]) ?: array_filter(array_map(static fn (Measures $beam) => $beam->createdAt, $pieces->beamsOf($stem->id)));

        return [] === $times ? null : min($times);
    }

    /**
     * Processed stems per week over the last completed weeks, at most TEMPO_WEEKS, none before the first week with a processed stem.
     *
     * @param array<string, Measures> $processed by id
     * @param array<string, float>    $share     Rm by stem id
     *
     * @return ?array{stems: float, rm: float, processed: int, processed_rm: float, weeks: string} null without a completed week
     */
    private static function tempo(array $processed, StemPieces $pieces, array $share, \DateTimeImmutable $now): ?array
    {
        $current = self::monday($now);
        $weekOf = [];
        foreach ($processed as $id => $stem) {
            if (null !== $at = self::processedAt($stem, $pieces)) {
                $weekOf[$id] = min(self::monday($at), $current);
            }
        }
        if ([] === $weekOf) {
            return null;
        }
        $start = max(min($weekOf), self::shift($current, -self::TEMPO_WEEKS));
        $weeks = intdiv((new \DateTimeImmutable("$start UTC"))->diff(new \DateTimeImmutable("$current UTC"))->days, 7);
        if (0 === $weeks) {
            return null;
        }
        $inWindow = array_keys(array_filter($weekOf, static fn (string $week) => $week >= $start && $week < $current));
        $rm = array_sum(array_map(static fn (string $id) => $share[$id] ?? 0.0, $inWindow));
        $first = self::isoWeek(new \DateTimeImmutable($start, new \DateTimeZone(self::TIMEZONE)));
        $last = self::isoWeek(new \DateTimeImmutable(self::shift($current, -1), new \DateTimeZone(self::TIMEZONE)));

        return [
            'stems' => \count($inWindow) / $weeks,
            'rm' => $rm / $weeks,
            'processed' => \count($inWindow),
            'processed_rm' => $rm,
            'weeks' => 1 === $weeks ? "1 Woche (KW $last)" : "$weeks Wochen (KW {$first}–$last)",
        ];
    }

    /** "KW 51", in another (ISO) year than now "KW 2/2027": open stems ÷ tempo weeks from now; "–" without a tempo above 0. */
    private static function supplyWeek(int $open, ?float $tempo, \DateTimeImmutable $now): string
    {
        if (null === $tempo || $tempo <= 0) {
            return self::NONE;
        }
        $berlin = new \DateTimeZone(self::TIMEZONE);
        $end = $now->modify(\sprintf('+%d seconds', (int) round($open / $tempo * 7 * 86400)))->setTimezone($berlin);
        $year = $end->format('o');

        return 'KW '.self::isoWeek($end).($year === $now->setTimezone($berlin)->format('o') ? '' : "/$year");
    }

    /** " Bei den Rm zählen nicht mit: 1 Polter ohne erfasste Raummeter (14 Stämme) und 3 Stämme ohne Polter."; null if none. */
    private static function rmLeftOut(int $piles, int $stemsOnThem, int $withoutPile): ?string
    {
        $parts = array_filter([
            $piles > 0 ? \sprintf('%d Polter ohne erfasste Raummeter (%d %s)', $piles, $stemsOnThem, self::stems($stemsOnThem)) : null,
            $withoutPile > 0 ? \sprintf('%d %s ohne Polter', $withoutPile, self::stems($withoutPile)) : null,
        ]);

        return [] === $parts ? null : 'Bei den Rm zählen nicht mit: '.implode(' und ', $parts).'.';
    }

    /** @return array<string, mixed> DashboardCard */
    private static function card(string $key, string $label, string $value, ?string $unit, ?string $secondary, string $formula, ?string $inserted, ?string $note, ?string $marker = null, bool $highlight = false, bool $startsRow = false): array
    {
        return [
            'key' => $key, 'label' => $label, 'value' => $value, 'unit' => $unit, 'secondary' => $secondary, 'marker' => $marker,
            'highlight' => $highlight, 'starts_row' => $startsRow, 'formula' => $formula, 'inserted' => $inserted, 'note' => $note,
        ];
    }

    private static function stems(int $count): string
    {
        return 1 === $count ? 'Stamm' : 'Stämme';
    }

    private static function count(int $count): string
    {
        return number_format($count, 0, ',', '.');
    }

    private static function decimal(float $value, int $decimals): string
    {
        return number_format($value, $decimals, ',', '.');
    }

    /** A share 0–1 as percent without the sign: "50,0" */
    private static function percent(float $share, int $decimals = 1): string
    {
        return self::decimal($share * 100, $decimals);
    }

    private static function isoWeek(\DateTimeImmutable $day): int
    {
        return (int) $day->format('W');
    }

    /** The Monday (YYYY-MM-DD) of the ISO week the time falls into, by the calendar of Berlin. */
    private static function monday(\DateTimeImmutable $at): string
    {
        return $at->setTimezone(new \DateTimeZone(self::TIMEZONE))->modify('monday this week')->format('Y-m-d');
    }

    /** The Monday $weeks weeks from the given one. */
    private static function shift(string $monday, int $weeks): string
    {
        return (new \DateTimeImmutable("$monday UTC"))->modify("$weeks weeks")->format('Y-m-d');
    }
}
