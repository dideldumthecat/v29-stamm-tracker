<?php

namespace App\Tests\Command;

use App\Entity\EventType;
use App\Entity\UserRole;
use App\Tests\Photo\PhotoMoveTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

class PhotoMoveCommandTest extends PhotoMoveTestCase
{
    private CommandTester $tester;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tester = new CommandTester((new Application(self::$kernel))->find('app:photo:move'));
    }

    /** @param list<string> $photos */
    private function move(string $target, array $photos, bool $dryRun = false): int
    {
        return $this->tester->execute(['target' => $target, 'photos' => $photos, '--dry-run' => $dryRun]);
    }

    private function display(): string
    {
        return preg_replace('/\s+/', ' ', $this->tester->getDisplay());
    }

    public function testMovesPhotosFromSeveralSourcesAndShowsThem(): void
    {
        $stem = $this->item('106');
        $beam = $this->item('106-A', $stem);
        $other = $this->item('9');
        $p1 = $this->photo($stem, '7df67d24-0000-7000-8000-000000000001', '2026-09-01 10:00:00');
        $p2 = $this->photo($other, '46016a7f-0000-7000-8000-000000000002', '2026-09-02 11:30:00');

        self::assertSame(Command::SUCCESS, $this->move('0106-a', ['7df67d24', '46016A7F-0000']));

        $display = $this->display();
        foreach ([$p1->toRfc4122(), '2026-09-01 10:00:00 UTC', '106 → 106-A', $p2->toRfc4122(), '9 → 106-A', 'Moved: 2, skipped (already there): 0'] as $expected) {
            self::assertStringContainsString($expected, $display);
        }
        $expected = [$p1->toRfc4122(), $p2->toRfc4122()];
        sort($expected);
        self::assertSame($expected, $this->photosOn($beam));
        self::assertSame([], $this->photosOn($stem));
        self::assertSame([], $this->photosOn($other));
        self::assertSame(2, $this->events(EventType::Voided));
        $this->assertRebuildChangesNothing();
    }

    public function testDryRunPrintsTheMovesAndWritesNothing(): void
    {
        $source = $this->item('1');
        $target = $this->item('2');
        $photo = $this->photo($source);

        self::assertSame(Command::SUCCESS, $this->move('2', [substr($photo->toRfc4122(), 0, 8)], dryRun: true));

        self::assertStringContainsString($photo->toRfc4122(), $this->display());
        self::assertStringContainsString('1 → 2', $this->display());
        self::assertStringContainsString('Would move: 1', $this->display());
        self::assertSame([$photo->toRfc4122()], $this->photosOn($source));
        self::assertSame([], $this->photosOn($target));
        self::assertSame(0, $this->events(EventType::Voided));
    }

    public function testPhotoAlreadyAtTheTargetIsReportedNotAnError(): void
    {
        $item = $this->item('2');
        $photo = $this->photo($item);

        self::assertSame(Command::SUCCESS, $this->move('2', [$photo->toRfc4122()]));

        self::assertStringContainsString('already at 2, skipped', $this->display());
        self::assertStringContainsString('Moved: 0, skipped (already there): 1', $this->display());
        self::assertSame(0, $this->events(EventType::Voided));
    }

    public function testAmbiguousBeginningListsTheMatchesWithTheirTagAndWritesNothing(): void
    {
        $this->item('2');
        $this->photo($this->item('1'), 'abcdef12-0000-7000-8000-000000000001');
        $this->photo($this->item('3'), 'abcdef12-0000-7000-8000-000000000002');

        self::assertSame(Command::FAILURE, $this->move('2', ['abcdef12']));
        self::assertStringContainsString('matches 2 photos', $this->display());
        self::assertStringContainsString('abcdef12-0000-7000-8000-000000000001 (1)', $this->display());
        self::assertStringContainsString('abcdef12-0000-7000-8000-000000000002 (3)', $this->display());

        self::assertSame(Command::SUCCESS, $this->move('2', ['abcdef12-0000-7000-8000-000000000002']));
    }

    #[DataProvider('failures')]
    public function testFailuresWriteNothing(string $target, string $photo, string $message): void
    {
        $this->item('2');
        $good = $this->photo($this->item('1'), '11111111-0000-7000-8000-000000000001');
        $other = $this->photo($this->item('3'), '22222222-0000-7000-8000-000000000002');
        $this->item('4');
        $this->em->getConnection()->executeStatement('UPDATE timber_items SET voided_at = NOW() WHERE tag_number = ?', ['4']);

        // The second photo of every call is valid, so a failure of the first must stop it from being moved too.
        self::assertSame(Command::FAILURE, $this->move($target, [$photo, '22222222']));

        self::assertStringContainsString($message, $this->display());
        self::assertSame(0, $this->events(EventType::Voided));
        self::assertSame([$good->toRfc4122()], $this->photosOn($this->target('1')->id));
        self::assertSame([$other->toRfc4122()], $this->photosOn($this->target('3')->id));
    }

    /** @return iterable<string, array{string, string, string}> */
    public static function failures(): iterable
    {
        yield 'not a tag' => ['abc', '11111111', 'is not a tag'];
        yield 'unknown target' => ['42', '11111111', 'No timber item with tag 42'];
        yield 'voided target' => ['4', '11111111', 'No timber item with tag 4'];
        yield 'unknown photo' => ['2', 'ffffffff', 'No photo with an ID starting with ffffffff'];
        yield 'too short' => ['2', '1111111', 'at least the first 8 characters'];
        yield 'not hex' => ['2', 'zzzzzzzzzz', 'is not a photo ID'];
    }

    public function testTheSamePhotoTwiceIsRefusedEvenAsIdAndBeginning(): void
    {
        $this->item('2');
        $this->photo($this->item('1'), '11111111-0000-7000-8000-000000000001');

        self::assertSame(Command::FAILURE, $this->move('2', ['11111111', '11111111-0000-7000-8000-000000000001']));
        self::assertStringContainsString('more than once', $this->display());
        self::assertSame(0, $this->events(EventType::Voided));
    }

    public function testPhotoWithoutActiveAssignmentFails(): void
    {
        $item = $this->item('1');
        $this->item('2');
        $photo = $this->photo($item);
        $recording = $this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE type = ?', ['attribute_recorded']);
        $this->em->persist(new \App\Entity\TimberItemEvent(\Symfony\Component\Uid\Uuid::v7(), $item, EventType::Voided, [], new \DateTimeImmutable(), $this->admin, \Symfony\Component\Uid\Uuid::fromBinary($recording)));
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->move('2', [$photo->toRfc4122()]));
        self::assertStringContainsString('is not on any item', $this->display());
    }

    public function testWithoutAPhotoAttributeNothingHappens(): void
    {
        $this->item('2');
        $photo = $this->photo($this->item('1'));
        $this->fotos->active = false;
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->move('2', [$photo->toRfc4122()]));
        self::assertStringContainsString('exactly one active attribute of type photo', $this->display());
        self::assertSame(0, $this->events(EventType::Voided));
    }

    public function testWithoutASuperadminNothingIsWritten(): void
    {
        $this->item('2');
        $photo = $this->photo($this->item('1'));
        $this->admin->role = UserRole::Admin;
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->move('2', [$photo->toRfc4122()]));
        self::assertStringContainsString('app:user:role', $this->display());
        self::assertSame(0, $this->events(EventType::Voided));
    }
}
