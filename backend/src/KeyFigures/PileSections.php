<?php

namespace App\KeyFigures;

use App\Pile\PileEditor;

/**
 * The cards of the page "Polter" (PileCardSection in frontend/shared/contract.ts), one per pile with at least one stem, the newest pile first.
 * The sums and the yield are those of KeyFigures::totals(), the same definitions as the dashboard, only over the stems of one pile.
 * Beams belong to the pile of their stem. Nothing here asks the database.
 */
final class PileSections
{
    private const TIMEZONE = 'Europe/Berlin';

    public function __construct(private readonly KeyFigures $figures)
    {
    }

    /**
     * @param list<Measures>             $items all stems and beams that are not voided
     * @param list<array<string, mixed>> $piles PileEditor::all(): the options of the attribute "source" with their master data
     * @param array<string, string>      $names attribute names by key, with source, sawn, unsawable and sawn_cross_section
     * @param \DateTimeImmutable         $now   decides which week is the current one
     *
     * @return list<array<string, mixed>>
     */
    public function build(array $items, array $piles, array $names, \DateTimeImmutable $now): array
    {
        $pieces = new StemPieces($items);
        $stemsOf = [];
        foreach ($pieces->stems() as $stem) {
            if (null !== $stem->pileId) {
                $stemsOf[$stem->pileId][] = $stem;
            }
        }

        // The ids of the options are UUIDv7, which start with the creation time: descending is the newest pile first
        usort($piles, static fn (array $a, array $b) => $b['id'] <=> $a['id']);

        $sections = [];
        foreach ($piles as $pile) {
            $stems = $stemsOf[$pile['id']] ?? [];
            if ([] === $stems) {
                continue;
            }
            $own = $stems;
            foreach ($stems as $stem) {
                array_push($own, ...$pieces->beamsOf($stem->id));
            }
            $figures = $this->figures->ofStems($own);
            $totals = $this->figures->totals($own, $figures);
            [$weeks, $average, $stemsAverage] = $this->weeks($stems, $pieces, $figures, $now);
            $sawnTimber = $totals->sawnTimber();

            $sections[] = [
                'type' => 'pile',
                'key' => 'pile-'.$pile['id'],
                'label' => null === $pile['number'] ? $pile['label'] : 'Polter '.PileEditor::label($pile['number'], $pile['location']),
                'notes' => $this->notes($names),
                'stems' => $totals->stems,
                'stacked_volume' => $pile['stacked_volume'],
                'latitude' => $pile['latitude'],
                'longitude' => $pile['longitude'],
                'progress' => ['sawn' => $totals->sawnStems, 'not_sawable' => $totals->unsawableStems, 'open' => $totals->stems - $totals->processed()],
                'sawn_timber_m3' => $totals->sawnStems > 0 ? $sawnTimber : null,
                'size_labels' => ['large' => KeyFigures::LARGE_BEAM_LABEL, 'small' => KeyFigures::SMALL_BEAM_LABEL],
                'weeks' => $weeks,
                'average_per_week' => $average,
                'stems_average_per_week' => $stemsAverage,
            ];
        }

        return $sections;
    }

    /**
     * Per ISO week (Monday to Sunday, Europe/Berlin), from the first week with a processed stem or a sawn beam to the current one, empty weeks with 0:
     * the sawn beams by size, and the processed stems.
     * A beam counts in the week it was created, a stem sawn whole in the week "sawn" was first recorded as yes (else its cross-section was recorded).
     * A processed stem counts in the week of StemPieces::processedAt() (the rule of the tempo on the dashboard), none without such a time.
     * A date after the current week (a device with the wrong clock) counts in the current week. The averages leave the current week out.
     * A beam without a readable cross-section opens its week but counts as neither large nor small.
     *
     * @param list<Measures>             $stems
     * @param array<string, StemFigures> $figures
     *
     * @return array{list<array{week_start: string, large: int, small: int, stems: int}>, ?float, ?float} the weeks, the average beams and the average stems per week
     */
    private function weeks(array $stems, StemPieces $pieces, array $figures, \DateTimeImmutable $now): array
    {
        $current = self::monday($now);
        $counts = [];
        $add = static function (?\DateTimeImmutable $at, ?string $size, bool $stem = false) use (&$counts, $current): void {
            if (null === $at) {
                return;
            }
            $week = min(self::monday($at), $current);
            $counts[$week] ??= ['large' => 0, 'small' => 0, 'stems' => 0];
            if (null !== $size) {
                ++$counts[$week][$size];
            }
            if ($stem) {
                ++$counts[$week]['stems'];
            }
        };
        foreach ($stems as $stem) {
            $sawn = $figures[$stem->id]->sawnTimber;
            if ($figures[$stem->id]->isSawn() || $stem->unsawableMarked) {
                $add($pieces->processedAt($stem), null, true);
            }
            if (null === $sawn) {
                continue;
            }
            if ($sawn->wholeStem) {
                $add($stem->sawnAt, KeyFigures::beamSize($sawn->pieces[0]));
                continue;
            }
            foreach ($pieces->beamsOf($stem->id) as $beam) {
                $add($beam->createdAt, KeyFigures::beamSize($this->figures->piece($beam)));
            }
        }
        if ([] === $counts) {
            return [[], null, null];
        }
        ksort($counts);

        $weeks = [];
        for ($day = new \DateTimeImmutable(array_key_first($counts), new \DateTimeZone(self::TIMEZONE)); ($start = $day->format('Y-m-d')) <= $current; $day = $day->modify('+1 week')) {
            $weeks[] = ['week_start' => $start, ...($counts[$start] ?? ['large' => 0, 'small' => 0, 'stems' => 0])];
        }
        $completed = array_filter($weeks, static fn (array $week) => $week['week_start'] < $current);
        $average = static fn (callable $count): ?float => [] === $completed ? null : (float) array_sum(array_map($count, $completed)) / \count($completed);

        return [$weeks, $average(static fn (array $week) => $week['large'] + $week['small']), $average(static fn (array $week) => $week['stems'])];
    }

    /** The Monday (YYYY-MM-DD) of the ISO week the time falls into, by the calendar of Berlin. */
    private static function monday(\DateTimeImmutable $at): string
    {
        return $at->setTimezone(new \DateTimeZone(self::TIMEZONE))->modify('monday this week')->format('Y-m-d');
    }

    /**
     * @param array<string, string> $names
     *
     * @return list<array{term: string, text: string}>
     */
    private function notes(array $names): array
    {
        return [
            ['term' => 'Stämme', 'text' => \sprintf('Alle Stämme, bei denen %s auf diesen Polter steht, ohne Balken und ohne entfernte.', $names['source'])],
            ['term' => 'Fortschritt', 'text' => \sprintf('(gesägt + nicht sägbar) ÷ Stämme. Als gesägt zählt ein Stamm, wenn %s angehakt ist, Balken vorhanden sind oder %s erfasst ist. Nicht sägbar ist ein Stamm mit Häkchen bei %s, der nicht gesägt ist.', $names['sawn'], $names['sawn_cross_section'], $names['unsawable'])],
            ['term' => 'Ausbeute', 'text' => 'Die drei Kennzahlen zeigen, was von diesem Polter bisher gesägt ist: die Zahl der gesägten Balken je Größe (siehe Groß und klein) und das Schnittholz. Nicht sägbare Stämme gehen nicht ein.'],
            ['term' => 'Schnittholz', 'text' => \sprintf('Volumen der gesägten Balken in fm, je Stück %s.', KeyFigures::pieceFormula($names))],
            ['term' => 'Stämme pro Woche', 'text' => \sprintf('Bearbeitete Stämme je Kalenderwoche (Montag bis Sonntag, Zeitzone Europe/Berlin), von der ersten Woche mit einem bearbeiteten Stamm oder gesägten Balken bis zur aktuellen; Wochen ohne Stamm zählen 0. Ein Stamm zählt in der Woche, in der %s oder %s zum ersten Mal auf Ja gesetzt wurde; sonst in der Woche, in der sein erster Balken angelegt bzw. %s erfasst wurde. Ein Stamm ohne einen dieser Zeitpunkte zählt in keiner Woche. Dieselbe Regel wie beim Tempo auf dem Dashboard.', $names['sawn'], $names['unsawable'], $names['sawn_cross_section'])],
            ['term' => 'Balken pro Woche', 'text' => \sprintf('Gesägte Balken je Kalenderwoche (Montag bis Sonntag, Zeitzone Europe/Berlin), von der ersten Woche mit einem bearbeiteten Stamm oder gesägten Balken bis zur aktuellen; Wochen ohne Balken zählen 0. Ein Balken zählt in der Woche, in der er angelegt wurde. Ein als Ganzes gesägter Stamm zählt als ein Balken in der Woche, in der das Merkmal %s zum ersten Mal auf Ja gesetzt wurde; ohne eine solche Erfassung zählt die Woche, in der das Merkmal %s erfasst wurde.', $names['sawn'], $names['sawn_cross_section'])],
            ['term' => 'Groß und klein', 'text' => \sprintf('Grundlage ist %s: Ist die kleinere Seite mindestens %d cm, ist der Balken %s, sonst %s. Ein Balken ohne lesbaren Querschnitt zählt weder als groß noch als klein.', $names['sawn_cross_section'], KeyFigures::LARGE_BEAM_MIN_SIDE_CM, KeyFigures::LARGE_BEAM_LABEL, KeyFigures::SMALL_BEAM_LABEL)],
            ['term' => 'Durchschnitt', 'text' => 'Balken bzw. Stämme ÷ Wochen, nur über die abgeschlossenen Wochen; die aktuelle Woche zählt nicht mit.'],
        ];
    }
}
