<?php

namespace App\Tests\Command;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Uid\Uuid;

class AttributeClearCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private TimberItemProjector $projector;
    private CommandTester $tester;
    private User $admin;
    private Attribute $diameter;
    private Attribute $other;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->projector = self::getContainer()->get(TimberItemProjector::class);
        $this->tester = new CommandTester((new Application($kernel))->find('app:attribute:clear'));

        $this->em->persist($this->admin = new User('Alexander', UserRole::Superadmin, User::hashToken('a')));
        $this->em->persist($this->diameter = new Attribute('Größter Stammdurchmesser', AttributeType::Number, isInheritable: true, key: 'mid_diameter_max'));
        $this->em->persist($this->other = new Attribute('Länge', AttributeType::Number, isInheritable: true));
        $this->em->flush();
    }

    /** @param array<string, mixed> $data */
    private function event(Uuid $item, EventType $type, array $data): void
    {
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, $type, $data, new \DateTimeImmutable(), $this->admin));
    }

    private function item(string $tag, ?Uuid $parent = null): Uuid
    {
        $id = Uuid::v7();
        $this->event($id, EventType::Created, ['parent_id' => $parent?->toRfc4122()]);
        $this->event($id, EventType::TagAssigned, ['tag_number' => $tag]);
        $this->em->flush();
        $this->projector->project($id);

        return $id;
    }

    private function record(Uuid $item, Attribute $attribute, mixed $value): void
    {
        $this->event($item, EventType::AttributeRecorded, ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $value]);
        $this->em->flush();
        $this->projector->project($item);
    }

    /** @param array<string, mixed> $input */
    private function clear(array $input): int
    {
        return $this->tester->execute($input + ['attribute' => 'Größter Stammdurchmesser', '--range' => 'all']);
    }

    public function testWithoutASuperadminNothingIsWritten(): void
    {
        $a = $this->item('1');
        $this->record($a, $this->diameter, 20);
        $this->admin->role = UserRole::Admin;
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->clear([]));
        self::assertStringContainsString('app:user:role', $this->tester->getDisplay());
        self::assertSame(0, $this->events(EventType::Voided));
    }

    private function events(EventType $type): int
    {
        return (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events WHERE type = ?', [$type->value]);
    }

    /** @return list<mixed> the item's current values of the attribute */
    private function values(Uuid $item, ?Attribute $attribute = null): array
    {
        $json = $this->em->getConnection()->fetchOne(
            'SELECT value_records FROM timber_item_state WHERE timber_item_id = ? AND attribute_id = ?',
            [$item->toBinary(), ($attribute ?? $this->diameter)->id->toBinary()],
        );

        return $json ? array_column(json_decode($json, true), 'value') : [];
    }

    public function testClearsEveryRecordingOfTheAttributeAndKeepsTheEvents(): void
    {
        $a = $this->item('1');
        $this->record($a, $this->diameter, 20);
        $this->record($a, $this->diameter, 30);
        $this->record($a, $this->other, 4.1);
        $b = $this->item('2');
        $this->record($b, $this->diameter, 25);

        self::assertSame(Command::SUCCESS, $this->clear([]));

        self::assertSame([], $this->values($a));
        self::assertSame([], $this->values($b));
        self::assertSame([4.1], $this->values($a, $this->other), 'other attributes stay');
        self::assertStringContainsString('Cleared: 2, skipped (no value): 0, no stem found: 0.', $this->tester->getDisplay());
        self::assertSame(4, $this->events(EventType::AttributeRecorded), 'the events stay');
        self::assertSame(3, $this->events(EventType::Voided));
        self::assertSame(['Alexander'], $this->em->getConnection()->fetchFirstColumn('SELECT DISTINCT u.name FROM timber_item_events e JOIN users u ON u.id = e.user_id WHERE e.type = ?', ['voided']));
    }

    public function testAttributeIsFoundByKeyOrByExactName(): void
    {
        $a = $this->item('1');
        $b = $this->item('2');
        $this->record($a, $this->diameter, 20);
        $this->record($b, $this->diameter, 25);

        self::assertSame(Command::SUCCESS, $this->clear(['attribute' => 'mid_diameter_max', '--range' => '1']));
        self::assertSame([], $this->values($a));
        self::assertSame([25], $this->values($b));

        self::assertSame(Command::SUCCESS, $this->clear(['--range' => '2']));
        self::assertSame([], $this->values($b));
    }

    public function testAValueRecordedAfterwardsCountsAgainAndAnotherRunDoesNothing(): void
    {
        $stem = $this->item('1');
        $this->record($stem, $this->diameter, 20);
        $this->clear([]);
        $this->clear([]);
        self::assertSame(1, $this->events(EventType::Voided));
        self::assertStringContainsString('Cleared: 0, skipped (no value): 1', $this->tester->getDisplay());

        $this->record($stem, $this->diameter, 33);
        self::assertSame([33], $this->values($stem));
    }

    public function testBeamsAreUntouchedAndInheritFromTheClearedStemNoMore(): void
    {
        $stem = $this->item('1');
        $beam = $this->item('1-A', $stem);
        $own = $this->item('1-B', $stem);
        $this->record($own, $this->diameter, 25);
        $this->record($stem, $this->diameter, 30);
        self::assertSame([30], $this->values($beam));

        $this->clear([]);

        self::assertSame([], $this->values($beam));
        self::assertSame([25], $this->values($own), 'the beam keeps its own recording');
        self::assertSame(1, $this->events(EventType::Voided));
    }

    public function testRangeLimitsTheStemsAndReportsMissingAndWithoutValue(): void
    {
        $a = $this->item('1');
        $b = $this->item('2');
        $this->item('3');
        $this->record($a, $this->diameter, 20);
        $this->record($b, $this->diameter, 25);

        $this->clear(['--range' => '1,3-4']);

        self::assertSame([], $this->values($a));
        self::assertSame([25], $this->values($b));
        self::assertStringContainsString('Cleared: 1, skipped (no value): 1, no stem found: 1.', $this->tester->getDisplay());
        self::assertStringContainsString('No stem with these numbers: 4.', $this->tester->getDisplay());
    }

    public function testDryRunWritesNothing(): void
    {
        $stem = $this->item('1');
        $this->record($stem, $this->diameter, 20);

        self::assertSame(Command::SUCCESS, $this->clear(['--dry-run' => true]));

        self::assertStringContainsString('Would clear: 1, skipped (no value): 0, no stem found: 0.', $this->tester->getDisplay());
        self::assertSame(0, $this->events(EventType::Voided));
        self::assertSame([20], $this->values($stem));
    }

    public function testRejectsInvalidInputWithoutWriting(): void
    {
        $this->em->persist(new Attribute('Notiz', AttributeType::Text, isSeries: true));
        $this->em->flush();
        $stem = $this->item('1');
        $this->record($stem, $this->diameter, 20);

        $cases = [
            'series' => [['attribute' => 'Notiz'], 'is a series'],
            'unknown attribute' => [['attribute' => 'größter stammdurchmesser'], 'No attribute with the key or name'],
            'bad range' => [['--range' => '10-1'], 'is not a range'],
        ];
        foreach ($cases as $name => [$input, $message]) {
            self::assertSame(Command::FAILURE, $this->clear($input), $name);
            self::assertStringContainsString($message, $this->tester->getDisplay(), $name);
            self::assertSame(0, $this->events(EventType::Voided), $name);
        }
        self::assertSame(Command::FAILURE, $this->tester->execute(['attribute' => 'Länge']));
        self::assertStringContainsString('--range is required', $this->tester->getDisplay());
    }
}
