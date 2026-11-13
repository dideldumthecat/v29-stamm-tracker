<?php

namespace App\Tests\Photo;

use App\Entity\EventType;
use App\Photo\PhotoMover;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Uid\Uuid;

class PhotoMoverTest extends PhotoMoveTestCase
{
    private PhotoMover $mover;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mover = self::getContainer()->get(PhotoMover::class);
    }

    /** Stem to beam, beam to beam, beam to stem, and back again; every step leaves the projection equal to a rebuild. */
    public function testMovesBetweenStemsAndBeamsAndBack(): void
    {
        $stem = $this->item('7');
        $a = $this->item('7-A', $stem);
        $b = $this->item('7-B', $stem);
        $photo = $this->photo($stem)->toRfc4122();

        foreach ([['7-A', $a, $stem], ['7-B', $b, $a], ['7', $stem, $b], ['7-A', $a, $stem]] as [$tag, $to, $from]) {
            $moves = $this->mover->move([Uuid::fromString($photo)], $this->target($tag), $this->admin);

            self::assertFalse($moves[0]->alreadyAtTarget);
            self::assertSame([$photo], $this->photosOn($to));
            self::assertSame([], $this->photosOn($from));
            $this->assertRebuildChangesNothing();
        }
        self::assertSame(4, $this->events(EventType::Voided));
        self::assertSame(5, $this->events(EventType::AttributeRecorded));
    }

    public function testSeveralPhotosFromDifferentSourcesInOneCall(): void
    {
        $one = $this->item('1');
        $two = $this->item('2');
        $target = $this->item('3');
        $stays = $this->photo($two);
        $p1 = $this->photo($one);
        $p2 = $this->photo($two);

        $moves = $this->mover->move([$p1, $p2], $this->target('3'), $this->admin);

        self::assertSame(['1', '2'], array_map(static fn ($move) => $move->sourceTag, $moves));
        $expected = [$p1->toRfc4122(), $p2->toRfc4122()];
        sort($expected);
        self::assertSame($expected, $this->photosOn($target));
        self::assertSame([$stays->toRfc4122()], array_values(array_diff($this->photosOn($two), [$p2->toRfc4122()])));
        self::assertSame([], $this->photosOn($one));
        self::assertSame($this->admin->id->toBinary(), $this->em->getConnection()->fetchOne('SELECT user_id FROM timber_item_events WHERE type = ?', ['voided']));
    }

    public function testPhotoAlreadyAtTheTargetIsSkipped(): void
    {
        $item = $this->item('1');
        $other = $this->item('2');
        $here = $this->photo($item);
        $there = $this->photo($other);

        $moves = $this->mover->move([$here, $there], $this->target('1'), $this->admin);

        self::assertSame([true, false], array_map(static fn ($move) => $move->alreadyAtTarget, $moves));
        self::assertSame(1, $this->events(EventType::Voided));
        self::assertCount(2, $this->photosOn($item));
    }

    public function testPlanWritesNothing(): void
    {
        $this->item('2');
        $photo = $this->photo($this->item('1'));
        $events = $this->events(EventType::AttributeRecorded);

        $moves = $this->mover->plan([$photo], $this->target('2'));

        self::assertSame(['1', '2'], [$moves[0]->sourceTag, $moves[0]->targetTag]);
        self::assertSame($events, $this->events(EventType::AttributeRecorded));
        self::assertSame(0, $this->events(EventType::Voided));
    }

    #[DataProvider('failures')]
    public function testAnyFailureWritesNothing(string $problem, string $message): void
    {
        $item = $this->item('1');
        $target = $this->item('2');
        $good = $this->photo($item);
        $second = match ($problem) {
            'unknown' => Uuid::v7(),
            'unassigned' => $this->unassigned($item),
            'twice' => $good,
            default => $this->photo($item),
        };
        if ('no attribute' === $problem) {
            $this->fotos->active = false;
            $this->em->flush();
        }
        if ('voided target' === $problem) {
            $this->em->getConnection()->executeStatement('UPDATE timber_items SET voided_at = NOW() WHERE id = ?', [$target->toBinary()]);
            $this->em->clear();
        }
        $events = $this->events(EventType::AttributeRecorded);
        $voids = $this->events(EventType::Voided);

        try {
            $this->mover->move([$good, $second], $this->target('2'), $this->admin);
            self::fail('A DomainException was expected.');
        } catch (\DomainException $e) {
            self::assertStringContainsString($message, $e->getMessage());
        }

        self::assertSame($events, $this->events(EventType::AttributeRecorded));
        self::assertSame($voids, $this->events(EventType::Voided));
    }

    /** @return iterable<string, array{string, string}> */
    public static function failures(): iterable
    {
        yield 'unknown photo' => ['unknown', 'No photo with the ID'];
        yield 'no active assignment' => ['unassigned', 'is not on any item'];
        yield 'same photo twice' => ['twice', 'more than once'];
        yield 'no photo attribute' => ['no attribute', 'exactly one active attribute of type photo'];
        yield 'voided target' => ['voided target', 'is voided'];
    }

    /** A photo whose only recording was voided: it exists but is shown nowhere. */
    private function unassigned(Uuid $item): Uuid
    {
        $photo = $this->photo($item);
        $recording = $this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE type = ? AND JSON_VALUE(data, ?) = ?', ['attribute_recorded', '$.value', $photo->toRfc4122()]);
        $this->em->persist(new \App\Entity\TimberItemEvent(Uuid::v7(), $item, EventType::Voided, [], new \DateTimeImmutable(), $this->admin, Uuid::fromBinary($recording)));
        $this->em->flush();

        return $photo;
    }
}
