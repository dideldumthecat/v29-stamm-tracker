<?php

namespace App\Tests\KeyFigures;

use App\KeyFigures\Measures;
use App\KeyFigures\StemPieces;
use PHPUnit\Framework\TestCase;

class StemPiecesTest extends TestCase
{
    private static function stem(string $id, bool $sawnMarked = false, bool $crossSection = false): Measures
    {
        return new Measures($id, null, $id, null, null, null, null, null, $crossSection, $sawnMarked);
    }

    private static function beam(string $stem, string $letter): Measures
    {
        return new Measures("$stem-$letter", $stem, "$stem-$letter", null, null, null, null, null, false, false);
    }

    /**
     * @param list<Measures> $pieces
     *
     * @return list<string>
     */
    private static function ids(array $pieces): array
    {
        return array_map(static fn (Measures $piece) => $piece->id, $pieces);
    }

    public function testStemWithBeamsYieldsItsBeamsByTag(): void
    {
        $pieces = new StemPieces([self::beam('1', 'B'), self::stem('1'), self::beam('1', 'A'), self::beam('2', 'A')]);

        self::assertSame(['1'], self::ids($pieces->stems()));
        self::assertSame(['1-A', '1-B'], self::ids($pieces->piecesOf('1')));
        self::assertTrue($pieces->isSawn('1'));
        self::assertFalse($pieces->isSawnWhole('1'));
    }

    public function testStemSawnWholeIsItsOwnPiece(): void
    {
        $pieces = new StemPieces([self::stem('1', sawnMarked: true), self::stem('2', crossSection: true)]);

        self::assertSame(['1'], self::ids($pieces->piecesOf('1')));
        self::assertSame(['2'], self::ids($pieces->piecesOf('2')));
        self::assertTrue($pieces->isSawnWhole('1'));
    }

    public function testStemNotSawnHasNoPieces(): void
    {
        $pieces = new StemPieces([self::stem('1')]);

        self::assertFalse($pieces->isSawn('1'));
        self::assertSame([], $pieces->piecesOf('1'));
    }

    public function testUnsawableStemIsNotSawn(): void
    {
        $unsawable = new Measures('1', null, '1', null, null, null, null, null, false, false, true);
        $pieces = new StemPieces([$unsawable]);

        self::assertFalse($pieces->isSawn('1'));
        self::assertSame([], $pieces->piecesOf('1'));
    }

    public function testVoidedBeamIsNotAmongTheItems(): void
    {
        // Voided items are left out before: without its only beam the stem is not sawn (or whole, if marked).
        self::assertSame([], (new StemPieces([self::stem('1')]))->piecesOf('1'));
        self::assertSame(['1'], self::ids((new StemPieces([self::stem('1', sawnMarked: true)]))->piecesOf('1')));
    }
}
