<?php

namespace App\Tests\KeyFigures;

use App\KeyFigures\KeyFigure;
use App\KeyFigures\KeyFigures;
use App\KeyFigures\Measures;
use App\KeyFigures\Missing;
use App\KeyFigures\StemFigures;
use PHPUnit\Framework\TestCase;

/** The numbers and the texts, on Measures alone: no database, no export, no HTTP. */
class KeyFiguresTest extends TestCase
{
    private const NAMES = ['mid_diameter_max' => 'Durchmesser groß', 'mid_diameter_min' => 'Durchmesser klein', 'length' => 'Länge'];

    private KeyFigures $figures;

    protected function setUp(): void
    {
        $this->figures = new KeyFigures();
    }

    private static function stem(string $id, ?float $max = null, ?float $min = null, ?float $length = 4.1, bool $sawnMarked = false, ?float $width = null, ?float $height = null): Measures
    {
        return new Measures($id, null, $id, $max, $min, $length, $width, $height, null !== $width, $sawnMarked);
    }

    private static function beam(string $stem, string $letter, ?float $width = null, ?float $height = null, ?float $length = 4.1): Measures
    {
        return new Measures("$stem-$letter", $stem, "$stem-$letter", null, null, $length, $width, $height, null !== $width, false);
    }

    /** @param list<Measures> $items */
    private function stemFigures(array $items, string $id): StemFigures
    {
        return $this->figures->ofStems($items)[$id] ?? self::fail("No figures for stem $id");
    }

    /** @param list<KeyFigure> $figures
     * @return array<string, KeyFigure>
     */
    private static function byKey(array $figures): array
    {
        return array_combine(array_map(static fn (KeyFigure $figure) => $figure->key, $figures), $figures);
    }

    public function testWorkedExample(): void
    {
        $stem = self::stem('104', 40, 39);
        $beams = [self::beam('104', 'A', 14.7, 14.7), self::beam('104', 'B', 14.7, 14.7), self::beam('104', 'C', 10.5, 14.7), self::beam('104', 'D', 10.5, 14.7)];

        $result = $this->stemFigures([$stem, ...$beams], '104');

        self::assertEqualsWithDelta(0.502, $result->roundWood->volume, 0.0005);
        self::assertEqualsWithDelta(0.304, $result->sawnTimber->volume, 0.0005);
        self::assertEqualsWithDelta(0.60, $result->yield, 0.005);
        self::assertCount(4, $result->sawnTimber->pieces);
        self::assertFalse($result->sawnTimber->wholeStem);

        $card = self::byKey($this->figures->stemCard($result, self::NAMES));
        self::assertSame(['round_wood', 'sawn_timber', 'yield'], array_keys($card));
        self::assertSame(['Rundholz', 'm³', 'aus 40 × 39 cm und 4,10 m', 'π ÷ 4 × Durchmesser groß × Durchmesser klein × Länge', '0,785 × 0,40 m × 0,39 m × 4,10 m'], [$card['round_wood']->label, $card['round_wood']->unit, $card['round_wood']->source, $card['round_wood']->formula, $card['round_wood']->inserted]);
        self::assertSame('Vorläufige Formel: Durchmesser mit Rinde, kein Abzug.', $card['round_wood']->note);
        self::assertSame(['Summe der 4 Balken', 'Summe des Schnittholzes aller Balken', '0,089 + 0,089 + 0,063 + 0,063 m³'], [$card['sawn_timber']->source, $card['sawn_timber']->formula, $card['sawn_timber']->inserted]);
        self::assertSame(['%', 'Schnittholz ÷ Rundholz', 'Schnittholz ÷ Rundholz', '0,304 m³ ÷ 0,502 m³'], [$card['yield']->unit, $card['yield']->source, $card['yield']->formula, $card['yield']->inserted]);
    }

    public function testOneDiameterCountsForBothAndSaysSo(): void
    {
        foreach ([self::stem('1', 40, null), self::stem('1', null, 40), self::stem('1', 40, 0), self::stem('1', 0, 40)] as $stem) {
            $round = $this->figures->roundWood($stem);

            self::assertEqualsWithDelta(M_PI / 4 * 0.4 * 0.4 * 4.1, $round->volume, 1e-9);
            self::assertTrue($round->oneDiameter);
        }

        $card = self::byKey($this->figures->stemCard($this->stemFigures([self::stem('1', 40, null)], '1'), self::NAMES))['round_wood'];
        self::assertSame('aus einem Durchmesser (40 cm) und 4,10 m', $card->source);
        self::assertSame('0,785 × 0,40 m × 0,40 m × 4,10 m', $card->inserted);
        self::assertStringContainsString('kreisrund', $card->note);
        self::assertFalse($this->figures->roundWood(self::stem('1', 40, 39))->oneDiameter);
    }

    public function testMissingInputsAreKeysAndTheTextNamesThem(): void
    {
        $none = $this->figures->roundWood(self::stem('2', 0, null, null));
        self::assertNull($none->volume);
        self::assertSame([Missing::Diameter, Missing::Length], $none->missing);

        $texts = [];
        foreach ([self::stem('2', null, null, 4.1), self::stem('3', 40, 39, null), self::stem('4', null, null, 0)] as $stem) {
            $card = $this->figures->stemCard($this->figures->ofStems([$stem])[$stem->id], self::NAMES);
            self::assertCount(1, $card, 'not sawn: round wood only');
            self::assertNull($card[0]->value);
            self::assertNull($card[0]->inserted);
            $texts[] = $card[0]->source;
        }
        self::assertSame(['Durchmesser fehlt', 'Länge fehlt', 'Durchmesser und Länge fehlen'], $texts);
    }

    public function testABeamWithoutCrossSectionMakesSawnTimberAndYieldNotCalculable(): void
    {
        $items = [self::stem('8', 34, 31), self::beam('8', 'A', 14.7, 14.7), self::beam('8', 'B'), self::beam('8', 'C', null, null, null)];

        $result = $this->stemFigures($items, '8');

        self::assertNull($result->sawnTimber->volume);
        self::assertNull($result->yield);
        self::assertSame([Missing::SawnTimber], $result->yieldMissing);
        $card = self::byKey($this->figures->stemCard($result, self::NAMES));
        self::assertSame('Querschnitt fehlt an Balken B, C; Länge fehlt an Balken C', $card['sawn_timber']->source);
        self::assertSame('Schnittholz fehlt', $card['yield']->source);
        self::assertNull($card['sawn_timber']->inserted);
        self::assertNull($card['yield']->inserted);
        self::assertNotNull($card['round_wood']->value);
    }

    public function testYieldNeedsRoundWoodToo(): void
    {
        $result = $this->stemFigures([self::stem('9', null, null), self::beam('9', 'A', 14.7, 14.7)], '9');
        self::assertSame([Missing::RoundWood], $result->yieldMissing);

        $result = $this->stemFigures([self::stem('9', null, null), self::beam('9', 'A')], '9');
        self::assertSame([Missing::SawnTimber, Missing::RoundWood], $result->yieldMissing);
        self::assertSame('Schnittholz und Rundholz fehlen', self::byKey($this->figures->stemCard($result, self::NAMES))['yield']->source);
    }

    public function testStemSawnWholeIsItsOwnPiece(): void
    {
        foreach ([self::stem('5', 34, 31, 4.1, false, 14.7, 14.7), self::stem('5', 34, 31, 4.1, true, 14.7, 14.7)] as $stem) {
            $sawn = $this->stemFigures([$stem], '5')->sawnTimber;

            self::assertTrue($sawn->wholeStem);
            self::assertCount(1, $sawn->pieces);
            self::assertEqualsWithDelta(0.147 * 0.147 * 4.1, $sawn->volume, 1e-9);
        }

        $card = self::byKey($this->figures->stemCard($this->stemFigures([self::stem('5', 34, 31, 4.1, false, 14.7, 14.7)], '5'), self::NAMES));
        self::assertSame('Stamm als Ganzes gesägt, 14,7 × 14,7 cm und 4,10 m', $card['sawn_timber']->source);
        self::assertSame('Breite × Höhe × Länge', $card['sawn_timber']->formula);
        self::assertSame('0,147 m × 0,147 m × 4,10 m', $card['sawn_timber']->inserted);

        $marked = self::byKey($this->figures->stemCard($this->stemFigures([self::stem('6', 34, 31, 4.1, true)], '6'), self::NAMES));
        self::assertSame('Querschnitt fehlt', $marked['sawn_timber']->source);
        self::assertSame('Schnittholz fehlt', $marked['yield']->source);
    }

    public function testAnUnsawnStemHasNoSawnTimberAndNoYield(): void
    {
        $result = $this->stemFigures([self::stem('7', 34, 31)], '7');

        self::assertNull($result->sawnTimber);
        self::assertNull($result->yield);
        self::assertSame([], $result->yieldMissing);
        self::assertSame(['round_wood'], array_map(static fn (KeyFigure $figure) => $figure->key, $this->figures->stemCard($result, self::NAMES)));
    }

    public function testABeamHasOnlyItsOwnSawnTimber(): void
    {
        $beam = $this->figures->beamCard($this->figures->piece(self::beam('104', 'A', 14.7, 14.7)), self::NAMES);

        self::assertCount(1, $beam);
        self::assertSame(['sawn_timber', 'Schnittholz', 'aus 14,7 × 14,7 cm und 4,10 m', '0,147 m × 0,147 m × 4,10 m'], [$beam[0]->key, $beam[0]->label, $beam[0]->source, $beam[0]->inserted]);
        self::assertEqualsWithDelta(0.088597, $beam[0]->value, 1e-6);

        $missing = $this->figures->beamCard($this->figures->piece(self::beam('104', 'B', null, null, null)), self::NAMES)[0];
        self::assertNull($missing->value);
        self::assertSame('Querschnitt und Länge fehlen', $missing->source);
        self::assertSame('Länge fehlt', $this->figures->beamCard($this->figures->piece(self::beam('104', 'B', 14.7, 14.7, null)), self::NAMES)[0]->source);
    }

    public function testOnePassOverManyStems(): void
    {
        $items = [
            self::beam('2', 'B', 14.7, 14.7), // a beam before its stem, and the beams of two stems mixed
            self::stem('1', 40, 39),
            self::beam('1', 'A', 14.7, 14.7),
            self::stem('2', 30, 30),
            self::stem('3'),
            self::beam('2', 'A', 10.5, 14.7),
            self::beam('99', 'A', 14.7, 14.7), // its stem is not among the items
            self::stem('4', 20, 20, 3.6, true),
        ];

        /** @var array{1: StemFigures, 2: StemFigures, 3: StemFigures, 4: StemFigures} $all */
        $all = $this->figures->ofStems($items);

        self::assertSame(['1', '2', '3', '4'], array_map('strval', array_keys($all)), 'in the order of the stems');
        self::assertCount(1, $all['1']->sawnTimber->pieces);
        self::assertSame(['2-A', '2-B'], array_map(static fn ($piece) => $piece->tag, $all['2']->sawnTimber->pieces), 'beams by tag');
        self::assertEqualsWithDelta(0.105 * 0.147 * 4.1 + 0.147 * 0.147 * 4.1, $all['2']->sawnTimber->volume, 1e-9);
        self::assertNull($all['3']->sawnTimber);
        self::assertSame([Missing::Diameter], $all['3']->roundWood->missing);
        self::assertSame([Missing::CrossSection], $all['4']->sawnTimber->pieces[0]->missing);
        // The same stem alone gives the same result as in the crowd.
        self::assertEquals($all['2'], $this->stemFigures([$items[3], $items[5], $items[0]], '2'));
    }
}
