<?php

namespace App\Tests\KeyFigures;

use App\KeyFigures\DashboardCards;
use App\KeyFigures\KeyFigures;
use App\KeyFigures\Measures;
use PHPUnit\Framework\TestCase;

/** The cards "Rundholz" and "Schnittholz" on Measures alone: Raummeter, week of processing, tempo and forecast. */
class DashboardCardsTest extends TestCase
{
    private const NAMES = [
        'source' => 'Polternummer', 'sawn' => 'Gesägt', 'unsawable' => 'Nicht sägbar', 'sawn_cross_section' => 'Gesägter Querschnitt',
        'mid_diameter_max' => 'Durchmesser groß', 'mid_diameter_min' => 'Durchmesser klein', 'length' => 'Länge',
    ];
    private const PILES = [
        ['id' => 'p1', 'stacked_volume' => 10.0],
        ['id' => 'p2', 'stacked_volume' => null],
        ['id' => 'p3', 'stacked_volume' => 3.0],
    ];

    /**
     * @param list<Measures> $items
     *
     * @return array<string, array<string, mixed>> the cards of both sections by key
     */
    private static function cards(array $items, string $now = '2026-11-21 12:00:00 Europe/Berlin'): array
    {
        $sections = (new DashboardCards(new KeyFigures()))->build($items, self::PILES, self::NAMES, new \DateTimeImmutable($now));

        return array_column([...$sections[0]['cards'], ...$sections[1]['cards']], null, 'key');
    }

    /** Processed if sawn or unsawable is given: the time "sawn" (or the cross-section) or "unsawable" was first yes. */
    private static function stem(string $id, ?string $pile = 'p1', ?string $sawnAt = null, ?string $unsawableAt = null): Measures
    {
        return new Measures($id, null, $id, 30, 30, 4.0, null, null, false, null !== $sawnAt, null !== $unsawableAt, $pile,
            new \DateTimeImmutable('2026-10-01 UTC'), null === $sawnAt ? null : new \DateTimeImmutable($sawnAt), null === $unsawableAt ? null : new \DateTimeImmutable($unsawableAt));
    }

    private static function beam(string $stem, string $createdAt): Measures
    {
        return new Measures("$stem-A", $stem, "$stem-A", null, null, 4.0, 14.7, 14.7, true, false, false, null, new \DateTimeImmutable($createdAt));
    }

    /**
     * One stem sawn in each of the weeks starting on the given Mondays (Berlin), on no pile.
     *
     * @return list<Measures>
     */
    private static function oneAWeek(string ...$mondays): array
    {
        return array_map(static fn (string $monday) => self::stem("s$monday", null, "$monday 10:00:00 Europe/Berlin"), $mondays);
    }

    public function testRmAreSharedOutPerStemAndPilesWithoutRmAndStemsWithoutPileAreLeftOut(): void
    {
        $cards = self::cards([
            // p1: 10 Rm over four stems, two of them processed
            self::stem('1', sawnAt: '2026-11-10 UTC'), self::stem('2', unsawableAt: '2026-11-10 UTC'), self::stem('3'), self::stem('4'),
            // p3: 3 Rm on one open stem
            self::stem('5', 'p3'),
            // left out: a pile without Rm, no pile, a pile that does not exist
            self::stem('6', 'p2', sawnAt: '2026-11-10 UTC'), self::stem('7', null), self::stem('8', 'gone'),
        ]);

        self::assertSame(['8', 'Stämme', '13,00 Rm'], [$cards['stems_total']['value'], $cards['stems_total']['unit'], $cards['stems_total']['secondary']], 'Gepoltert without ≈');
        self::assertSame('10,00 + 3,00 Rm', $cards['stems_total']['inserted']);
        self::assertSame('37,5 % ≈ 5,00 Rm', $cards['stems_processed']['secondary'], 'two quarters of p1; stem 6 adds no Rm');
        self::assertSame('5 Stämme ≈ 8,00 Rm offen', $cards['supply']['secondary']);
        self::assertSame('Bei den Rm zählen nicht mit: 1 Polter ohne erfasste Raummeter (1 Stamm) und 2 Stämme ohne Polter.', $cards['stems_total']['note']);
        self::assertStringEndsWith('Bei den Rm zählen nicht mit: 1 Polter ohne erfasste Raummeter (1 Stamm) und 2 Stämme ohne Polter.', $cards['supply']['note']);
        self::assertSame(['1', 'Stamm', '33,3 % der bearbeiteten'], [$cards['stems_unsawable']['value'], $cards['stems_unsawable']['unit'], $cards['stems_unsawable']['secondary']]);
    }

    public function testAStemCountsInTheWeekItWasFirstProcessed(): void
    {
        $cards = self::cards([
            // KW 46: unsawable
            self::stem('1', unsawableAt: '2026-11-10 09:00:00 UTC'),
            // KW 46: no time of its own, its first beam decides
            self::stem('2'), self::beam('2', '2026-11-11 09:00:00 UTC'),
            // KW 45: unsawable first, sawn later; the earlier one counts and makes KW 45 the first week
            self::stem('3', sawnAt: '2026-11-12 09:00:00 UTC', unsawableAt: '2026-11-03 09:00:00 UTC'),
            // After the current week: counts in the current one, which the tempo leaves out
            self::stem('4', sawnAt: '2026-12-01 09:00:00 UTC'),
        ]);

        self::assertSame('1,5', $cards['tempo']['value']);
        self::assertSame('Stämme / Woche', $cards['tempo']['unit']);
        self::assertSame('≈ 3,75 Rm / Woche', $cards['tempo']['secondary']);
        self::assertSame('3 Stämme ÷ 2 Wochen (KW 45–46); 7,50 Rm ÷ 2 Wochen (KW 45–46)', $cards['tempo']['inserted']);
        self::assertTrue($cards['tempo']['starts_row']);
    }

    public function testTheTempoTakesTheLastFourCompletedWeeks(): void
    {
        // KW 41 to 47, two stems in KW 41 and none in KW 44; KW 47 is the current one
        $cards = self::cards([...self::oneAWeek('2026-10-05', '2026-10-12', '2026-10-19', '2026-11-02', '2026-11-09', '2026-11-16'), self::stem('x', null, '2026-10-05 10:00:00 UTC')]);

        self::assertSame('0,8', $cards['tempo']['value'], 'KW 43 to 46: three stems in four weeks');
        self::assertSame('3 Stämme ÷ 4 Wochen (KW 43–46); 0,00 Rm ÷ 4 Wochen (KW 43–46)', $cards['tempo']['inserted']);
    }

    public function testWithoutACompletedWeekThereIsNoTempoAndNoForecast(): void
    {
        foreach ([[], self::oneAWeek('2026-11-16')] as $items) {
            $cards = self::cards([...$items, self::stem('open')]);

            self::assertSame(['–', null, null, null], [$cards['tempo']['value'], $cards['tempo']['unit'], $cards['tempo']['secondary'], $cards['tempo']['inserted']]);
            self::assertSame('–', $cards['supply']['value']);
            self::assertTrue($cards['supply']['highlight']);
            self::assertSame('1 Stamm ≈ 10,00 Rm offen', $cards['supply']['secondary']);
        }
    }

    public function testATempoOfZeroHasNoForecast(): void
    {
        $cards = self::cards([...self::oneAWeek('2026-09-07'), self::stem('open')]);

        self::assertSame('0,0', $cards['tempo']['value']);
        self::assertSame('–', $cards['supply']['value']);
        self::assertNull($cards['supply']['inserted']);
    }

    public function testTheForecastIsTheWeekOfTodayPlusOpenStemsByTempo(): void
    {
        // One a week in KW 44 to 47, today Saturday 28 Nov (KW 48), 3 open: three weeks later is 19 Dec, KW 51
        $open = [self::stem('o1'), self::stem('o2'), self::stem('o3')];
        $cards = self::cards([...self::oneAWeek('2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'), ...$open], '2026-11-28 12:00:00 Europe/Berlin');

        self::assertSame('1,0', $cards['tempo']['value']);
        self::assertSame('KW 51', $cards['supply']['value'], 'KW 48 + 3 weeks');
        self::assertSame('3 Stämme ÷ 1,0 Stämme / Woche ≈ 3,0 Wochen ab 28.11.2026', $cards['supply']['inserted']);
    }

    public function testAForecastInAnotherYearNamesTheYear(): void
    {
        // One a week in KW 46 to 49, today Thursday 10 Dec (KW 50), 6 open: Thursday 21 Jan 2027 is KW 3
        $open = array_map(static fn (int $n) => self::stem("o$n"), range(1, 6));
        $cards = self::cards([...self::oneAWeek('2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'), ...$open], '2026-12-10 12:00:00 Europe/Berlin');

        self::assertSame('KW 3/2027', $cards['supply']['value']);
    }

    public function testNothingOpenIsTheCurrentWeek(): void
    {
        $cards = self::cards(self::oneAWeek('2026-11-09', '2026-11-16'));

        self::assertSame('KW 47', $cards['supply']['value']);
    }

    public function testTheSawnTimberCardsCountPiecesBySize(): void
    {
        $small = new Measures('1-B', '1', '1-B', null, null, 4.0, 10.5, 14.7, true, false, false, null, new \DateTimeImmutable('2026-11-10 UTC'));
        $unreadable = new Measures('1-C', '1', '1-C', null, null, 4.0, null, null, false, false, false, null, new \DateTimeImmutable('2026-11-10 UTC'));
        $whole = new Measures('2', null, '2', 30, 30, 4.0, 14.7, 14.7, true, true, false, 'p1', new \DateTimeImmutable('2026-10-01 UTC'), new \DateTimeImmutable('2026-11-10 UTC'));
        $cards = self::cards([self::stem('1'), self::beam('1', '2026-11-10 UTC'), $small, $unreadable, $whole, self::stem('3', unsawableAt: '2026-11-10 UTC')]);

        self::assertSame(['4', 'Balken'], [$cards['beams_total']['value'], $cards['beams_total']['unit']]);
        self::assertSame('0,23 m³ · aus 2 Stämmen', $cards['beams_total']['secondary'], 'the piece without cross-section is left out of the sum');
        self::assertSame(['14×14 (groß)', '2', '50 % der Balken', 'large'], [$cards['beams_large']['label'], $cards['beams_large']['value'], $cards['beams_large']['secondary'], $cards['beams_large']['marker']]);
        self::assertSame(['10×14 (klein)', '1', '25 % der Balken', 'small'], [$cards['beams_small']['label'], $cards['beams_small']['value'], $cards['beams_small']['secondary'], $cards['beams_small']['marker']]);
        self::assertSame('1 Balken ohne lesbaren Querschnitt zählt weder als groß noch als klein.', $cards['beams_small']['note']);
        self::assertSame('2 gesägte Stämme', $cards['yield']['secondary'], 'the unsawable stem does not count');
    }
}
