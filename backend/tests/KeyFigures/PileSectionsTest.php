<?php

namespace App\Tests\KeyFigures;

use App\KeyFigures\KeyFigures;
use App\KeyFigures\Measures;
use App\KeyFigures\PileSections;
use PHPUnit\Framework\TestCase;

/** The pile cards on Measures alone: no database, no HTTP. */
class PileSectionsTest extends TestCase
{
    private const NAMES = [
        'source' => 'Polternummer', 'sawn' => 'Gesägt', 'unsawable' => 'Nicht sägbar', 'sawn_cross_section' => 'Gesägter Querschnitt',
        'mid_diameter_max' => 'Durchmesser groß', 'mid_diameter_min' => 'Durchmesser klein', 'length' => 'Länge',
    ];
    private const PILES = [
        ['id' => 'p1', 'label' => '2601-010145 (Krummes F)', 'number' => '2601-010145', 'location' => 'Krummes F', 'latitude' => 51.1, 'longitude' => 12.3, 'stacked_volume' => 51.52],
        ['id' => 'p2', 'label' => '02', 'number' => null, 'location' => null, 'latitude' => null, 'longitude' => null, 'stacked_volume' => null],
        ['id' => 'p3', 'label' => '2601-010200', 'number' => '2601-010200', 'location' => null, 'latitude' => null, 'longitude' => null, 'stacked_volume' => null],
    ];

    /**
     * @param list<Measures> $items
     *
     * @return list<array<string, mixed>>
     */
    private function sections(array $items, string $now = '2026-11-21 12:00:00 Europe/Berlin'): array
    {
        return (new PileSections(new KeyFigures()))->build($items, self::PILES, self::NAMES, new \DateTimeImmutable($now));
    }

    private static function stem(string $id, string $pile = 'p1', ?float $max = 30, ?float $min = 30, bool $unsawable = false, ?string $sawnAt = null, ?float $width = null, ?float $height = null): Measures
    {
        return new Measures($id, null, $id, $max, $min, 4.0, $width, $height, null !== $width, null !== $sawnAt && null === $width, $unsawable, $pile, new \DateTimeImmutable('2026-10-01 UTC'), null === $sawnAt ? null : new \DateTimeImmutable($sawnAt));
    }

    private static function beam(string $stem, string $letter, string $createdAt, ?float $width = 14.7, ?float $height = 14.7): Measures
    {
        return new Measures("$stem-$letter", $stem, "$stem-$letter", null, null, 4.0, $width, $height, null !== $width, false, false, null, new \DateTimeImmutable($createdAt));
    }

    /**
     * @param array<string, mixed> $section
     *
     * @return list<array{string, int, int}>
     */
    private static function weekRows(array $section): array
    {
        return array_map(static fn (array $week) => [$week['week_start'], $week['large'], $week['small']], $section['weeks']);
    }

    public function testOnlyPilesWithAStemGetACardNewestPileFirst(): void
    {
        $sections = $this->sections([self::stem('1', 'p1'), self::stem('2', 'p3'), self::stem('3', 'unknown'), self::stem('4', 'p3')]);

        self::assertSame(['pile-p3', 'pile-p1'], array_column($sections, 'key'), 'descending by id, whatever the order of the piles');
        self::assertSame(['Polter 2601-010200', 'Polter 2601-010145 (Krummes F)'], array_column($sections, 'label'));
        self::assertSame([2, 1], array_column($sections, 'stems'));
        self::assertSame(51.52, $sections[1]['stacked_volume']);
    }

    public function testAPileWithoutMasterDataIsNamedByItsOption(): void
    {
        self::assertSame('02', $this->sections([self::stem('1', 'p2')])[0]['label']);
    }

    public function testAnEmptyPileHasNoWeeksNoAverageAndNothingToCalculate(): void
    {
        $section = $this->sections([self::stem('1'), self::stem('2')])[0];

        self::assertSame(['sawn' => 0, 'not_sawable' => 0, 'open' => 2], $section['progress']);
        self::assertNull($section['sawn_timber_m3']);
        self::assertSame([], $section['weeks']);
        self::assertNull($section['average_per_week']);
        self::assertSame(['large' => 'Balken 14×14', 'small' => 'Balken 10×14'], $section['size_labels']);
    }

    public function testProgressAndSawnTimberUseTheDefinitionsOfTheSawingSection(): void
    {
        $items = [
            self::stem('1', max: 40, min: 40), self::beam('1', 'A', '2026-11-10 08:00:00 UTC'), self::beam('1', 'B', '2026-11-10 08:00:00 UTC', 10.5, 14.7),
            self::stem('2', unsawable: true),
            self::stem('3'),
            self::stem('4', 'p3'),
        ];

        $section = $this->sections($items)[1]; // p3 is the first card

        self::assertSame(['sawn' => 1, 'not_sawable' => 1, 'open' => 1], $section['progress']);
        self::assertEqualsWithDelta((0.147 * 0.147 + 0.105 * 0.147) * 4.0, $section['sawn_timber_m3'], 1e-9);
    }

    public function testWeeksRunFromTheFirstBeamToTheCurrentWeekWithGapsAsZero(): void
    {
        // Now is Saturday 21 Nov 2026, the current week starts Monday 16 Nov.
        $items = [
            self::stem('1'),
            self::beam('1', 'A', '2026-10-28 10:00:00 UTC'),            // week of 26 Oct, large
            self::beam('1', 'B', '2026-10-30 10:00:00 UTC', 10.5, 14.7), // same week, small
            self::beam('1', 'C', '2026-11-12 10:00:00 UTC'),            // week of 9 Nov
            self::beam('1', 'E', '2026-11-13 10:00:00 UTC'),
            self::beam('1', 'D', '2026-11-16 09:00:00 UTC'),            // the current week
        ];

        $section = $this->sections($items)[0];

        self::assertSame([['2026-10-26', 1, 1], ['2026-11-02', 0, 0], ['2026-11-09', 2, 0], ['2026-11-16', 1, 0]], self::weekRows($section));
        self::assertSame(4 / 3, $section['average_per_week'], 'the current week does not count, the empty one does');
    }

    public function testTheWeekIsTheOneOfBerlinAndTheWeekEndsOnSunday(): void
    {
        $items = [
            self::stem('1'),
            self::beam('1', 'A', '2026-11-08 23:30:00 UTC'), // Monday 9 Nov 00:30 in Berlin
            self::beam('1', 'B', '2026-11-08 22:30:00 UTC'), // Sunday 8 Nov 23:30 in Berlin
        ];

        self::assertSame([['2026-11-02', 1, 0], ['2026-11-09', 1, 0], ['2026-11-16', 0, 0]], self::weekRows($this->sections($items)[0]));
    }

    public function testTheYearEndHasWeek53AndTheNextWeekStartsInJanuary(): void
    {
        // 2026 has 53 ISO weeks: KW 52 starts on 21 Dec, KW 53 on 28 Dec, KW 1 of 2027 on 4 Jan.
        $items = [
            self::stem('1'),
            self::beam('1', 'A', '2026-12-16 10:00:00 UTC'),
            self::beam('1', 'B', '2026-12-31 10:00:00 UTC'),
            self::beam('1', 'C', '2027-01-02 10:00:00 UTC', 10.5, 14.7),
        ];

        $section = $this->sections($items, '2027-01-05 12:00:00 Europe/Berlin')[0];

        self::assertSame([['2026-12-14', 1, 0], ['2026-12-21', 0, 0], ['2026-12-28', 1, 1], ['2027-01-04', 0, 0]], self::weekRows($section));
        self::assertSame(1.0, $section['average_per_week']);
    }

    public function testWithoutACompletedWeekThereIsNoAverage(): void
    {
        $section = $this->sections([self::stem('1'), self::beam('1', 'A', '2026-11-17 10:00:00 UTC')])[0];

        self::assertSame([['2026-11-16', 1, 0]], self::weekRows($section));
        self::assertNull($section['average_per_week']);
    }

    public function testAStemSawnWholeCountsOnceInTheWeekItsCheckmarkWasRecorded(): void
    {
        $items = [
            self::stem('1', sawnAt: '2026-11-03 09:00:00 UTC', width: null),                // checkmark only: no cross-section, in neither size
            self::stem('2', sawnAt: '2026-11-04 09:00:00 UTC', width: 14.7, height: 14.7),  // cross-section: counts by the time recorded
            self::stem('3', sawnAt: '2026-11-18 09:00:00 UTC', width: 10.5, height: 14.7),
        ];

        $section = $this->sections($items)[0];

        self::assertSame(['sawn' => 3, 'not_sawable' => 0, 'open' => 0], $section['progress']);
        self::assertSame([['2026-11-02', 1, 0], ['2026-11-09', 0, 0], ['2026-11-16', 0, 1]], self::weekRows($section));
    }

    public function testADateAfterTheCurrentWeekCountsInTheCurrentWeek(): void
    {
        $section = $this->sections([self::stem('1'), self::beam('1', 'A', '2026-12-24 10:00:00 UTC')])[0];

        self::assertSame([['2026-11-16', 1, 0]], self::weekRows($section));
    }

    public function testTheNotesNameTheAttributes(): void
    {
        $notes = array_column($this->sections([self::stem('1')])[0]['notes'], 'text', 'term');

        self::assertSame(['Stämme', 'Fortschritt', 'Ausbeute', 'Schnittholz', 'Balken pro Woche', 'Groß und klein', 'Durchschnitt'], array_keys($notes));
        self::assertStringContainsString('Polternummer', $notes['Stämme']);
        self::assertStringContainsString('Breite × Höhe × Länge', $notes['Schnittholz']);
        self::assertStringContainsString('mindestens 12 cm', $notes['Groß und klein']);
    }
}
