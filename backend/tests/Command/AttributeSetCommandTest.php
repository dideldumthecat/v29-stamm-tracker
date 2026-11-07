<?php

namespace App\Tests\Command;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
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

class AttributeSetCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private TimberItemProjector $projector;
    private CommandTester $tester;
    private User $admin;
    private Attribute $length;
    private AttributeOption $long;
    private AttributeOption $short;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->projector = self::getContainer()->get(TimberItemProjector::class);
        $this->tester = new CommandTester((new Application($kernel))->find('app:attribute:set'));

        $this->em->persist($this->admin = new User('Alexander', UserRole::Superadmin, User::hashToken('a')));
        $this->em->persist($this->length = new Attribute('Länge', AttributeType::Choice, isInheritable: true, key: 'length'));
        $this->em->persist($this->long = new AttributeOption($this->length, '4,10 m'));
        $this->em->persist($this->short = new AttributeOption($this->length, '3,60 m'));
        $this->em->flush();
    }

    private function item(string $tag, ?Uuid $parent = null): Uuid
    {
        $id = Uuid::v7();
        $this->event($id, EventType::Created, ['parent_id' => $parent?->toRfc4122()]);
        $this->event($id, EventType::TagAssigned, ['tag_number' => $tag]);
        $this->em->flush();
        $this->projector->project($id);
        if ($parent) {
            $this->projector->project($parent);
        }

        return $id;
    }

    /** @param array<string, mixed> $data */
    private function event(Uuid $item, EventType $type, array $data, ?Uuid $reference = null): void
    {
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, $type, $data, new \DateTimeImmutable(), $this->admin, $reference));
    }

    private function record(Uuid $item, Attribute $attribute, mixed $value): void
    {
        $this->event($item, EventType::AttributeRecorded, ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $value]);
        $this->em->flush();
        $this->projector->project($item);
    }

    /** @param array<string, mixed> $input */
    private function set(array $input): int
    {
        return $this->tester->execute($input + ['attribute' => 'Länge', 'value' => '4,10 m', '--range' => 'all']);
    }

    public function testWithoutASuperadminNothingIsWritten(): void
    {
        $this->item('1');
        $this->admin->role = UserRole::Admin;
        $this->em->flush();

        self::assertSame(Command::FAILURE, $this->set([]));
        self::assertStringContainsString('app:user:role', $this->tester->getDisplay());
        self::assertSame(0, $this->events());
    }

    private function events(): int
    {
        return (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events WHERE type = ?', ['attribute_recorded']);
    }

    /** @return list<mixed> the item's current values of the attribute */
    private function values(Uuid $item, ?Attribute $attribute = null): array
    {
        $rows = $this->em->getConnection()->fetchFirstColumn(
            'SELECT value_records FROM timber_item_state WHERE timber_item_id = ? AND attribute_id = ?',
            [$item->toBinary(), ($attribute ?? $this->length)->id->toBinary()],
        );

        return array_map(static fn (string $json) => array_column(json_decode($json, true), 'value'), $rows)[0] ?? [];
    }

    public function testSetsTheValueOnStemsWithoutOneAsEvents(): void
    {
        $a = $this->item('1');
        $b = $this->item('2');

        self::assertSame(Command::SUCCESS, $this->set([]));

        self::assertSame([$this->long->id->toRfc4122()], $this->values($a));
        self::assertSame([$this->long->id->toRfc4122()], $this->values($b));
        self::assertSame(2, $this->events());
        self::assertSame(['Alexander'], $this->em->getConnection()->fetchFirstColumn('SELECT DISTINCT u.name FROM timber_item_events e JOIN users u ON u.id = e.user_id WHERE e.type = ?', ['attribute_recorded']));
    }

    public function testAttributeIsFoundByKeyOrByExactName(): void
    {
        $a = $this->item('1');
        $b = $this->item('2');

        self::assertSame(Command::SUCCESS, $this->set(['attribute' => 'length', '--range' => '1']));
        self::assertSame(Command::SUCCESS, $this->set(['attribute' => 'Länge', '--range' => '2']));

        self::assertSame([$this->long->id->toRfc4122()], $this->values($a));
        self::assertSame([$this->long->id->toRfc4122()], $this->values($b));
        self::assertSame(Command::FAILURE, $this->set(['attribute' => 'LENGTH']));
        self::assertSame(2, $this->events());
    }

    public function testKeepsDifferentValuesByDefaultAndReplacesThemWithOverwrite(): void
    {
        $same = $this->item('1');
        $other = $this->item('2');
        $this->record($same, $this->length, $this->long->id->toRfc4122());
        $this->record($other, $this->length, $this->short->id->toRfc4122());

        $this->set([]);
        self::assertSame([$this->short->id->toRfc4122()], $this->values($other));
        self::assertStringContainsString('skipped (value already set): 2', $this->tester->getDisplay());
        self::assertSame(2, $this->events());

        $this->set(['--overwrite' => true]);
        self::assertSame([$this->long->id->toRfc4122()], $this->values($other));
        self::assertSame(3, $this->events(), 'only the differing stem gets an event');
        self::assertStringContainsString('2: 3,60 m → 4,10 m', $this->tester->getDisplay());
    }

    public function testIgnoresVoidedStemsAndBeamsButBeamsInheritFromASplitStem(): void
    {
        $voided = $this->item('1');
        $this->event($voided, EventType::Voided, [], $voided);
        $this->em->flush();
        $this->projector->project($voided);
        $split = $this->item('2');
        $beam = $this->item('2-A', $split);
        $own = $this->item('2-B', $split);
        $this->record($own, $this->length, $this->short->id->toRfc4122());

        $this->set([]);

        self::assertSame([], $this->values($voided));
        self::assertSame([$this->long->id->toRfc4122()], $this->values($split));
        self::assertSame([$this->long->id->toRfc4122()], $this->values($beam), 'inherited, not copied');
        self::assertSame([$this->short->id->toRfc4122()], $this->values($own));
        self::assertSame(2, $this->events(), 'one for the split stem, one earlier on the beam');
        self::assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events WHERE timber_item_id = ? AND type = ?', [$beam->toBinary(), 'attribute_recorded']));
    }

    /**
     * @return iterable<string, array{string, list<string>}>
     */
    public static function ranges(): iterable
    {
        yield 'all' => ['all', ['1', '5', '12', '20']];
        yield 'single' => ['5', ['5']];
        yield 'leading zeros' => ['0005', ['5']];
        yield 'from-to' => ['1-12', ['1', '5', '12']];
        yield 'list' => ['1-5,20', ['1', '5', '20']];
        yield 'list with zeros and spaces' => ['001, 012', ['1', '12']];
    }

    /**
     * @param list<string> $expected
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('ranges')]
    public function testRangeForms(string $range, array $expected): void
    {
        $items = [];
        foreach (['1', '5', '12', '20'] as $tag) {
            $items[$tag] = $this->item($tag);
        }

        self::assertSame(Command::SUCCESS, $this->set(['--range' => $range]));

        $set = array_keys(array_filter($items, fn (Uuid $id) => [] !== $this->values($id)));
        self::assertSame($expected, array_map('strval', $set));
    }

    public function testReportsNumbersWithoutAStemAndIsIdempotent(): void
    {
        $this->item('1');

        self::assertSame(Command::SUCCESS, $this->set(['--range' => '1-3']));
        self::assertStringContainsString('No stem with these numbers: 2, 3.', $this->tester->getDisplay());
        self::assertSame(1, $this->events());

        $this->set(['--range' => '1-3', '--overwrite' => true]);
        self::assertSame(1, $this->events());
    }

    public function testDryRunWritesNothingButCountsAndListsReplacements(): void
    {
        $this->item('1');
        $replaced = $this->item('2');
        $this->record($replaced, $this->length, $this->short->id->toRfc4122());

        $this->set(['--dry-run' => true, '--overwrite' => true, '--range' => '1-3']);

        $display = $this->tester->getDisplay();
        self::assertStringContainsString('Would set: 2, skipped (value already set): 0, no stem found: 1.', $display);
        self::assertStringContainsString('2: 3,60 m → 4,10 m', $display);
        self::assertSame(1, $this->events());
    }

    public function testNumberBooleanAndMonthAreParsedLikeTheApp(): void
    {
        $this->em->persist($diameter = new Attribute('Durchmesser', AttributeType::Number, isInheritable: true));
        $this->em->persist($sawn = new Attribute('Gesägt', AttributeType::Boolean, isInheritable: true));
        $this->em->persist($felled = new Attribute('Fällzeitpunkt', AttributeType::Month, isInheritable: true));
        $this->em->flush();
        $stem = $this->item('1');

        self::assertSame(Command::SUCCESS, $this->set(['attribute' => 'Durchmesser', 'value' => '34,5']));
        self::assertSame(Command::SUCCESS, $this->set(['attribute' => 'Gesägt', 'value' => 'nein']));
        self::assertSame(Command::SUCCESS, $this->set(['attribute' => 'Fällzeitpunkt', 'value' => '2026-09']));

        self::assertSame([34.5], $this->values($stem, $diameter));
        self::assertSame([false], $this->values($stem, $sawn));
        self::assertSame(['2026-09'], $this->values($stem, $felled));

        $this->set(['attribute' => 'Gesägt', 'value' => 'ja', '--overwrite' => true]);
        self::assertSame([true], $this->values($stem, $sawn));
    }

    public function testRejectsInvalidInputWithoutWriting(): void
    {
        $this->em->persist(new Attribute('Notiz', AttributeType::Text, isSeries: true, isInheritable: true));
        $this->em->persist(new Attribute('Entrindet', AttributeType::Boolean));
        $this->em->persist(new Attribute('Durchmesser', AttributeType::Number, isInheritable: true));
        $this->em->persist(new Attribute('Alt', AttributeType::Boolean, isInheritable: true, active: false));
        $this->em->persist(new Attribute('Fällzeitpunkt', AttributeType::Month, isInheritable: true));
        $this->em->flush();
        $this->item('1');

        $cases = [
            'series' => [['attribute' => 'Notiz', 'value' => 'x'], 'a series'],
            'not inheritable' => [['attribute' => 'Entrindet', 'value' => 'ja'], 'not inheritable'],
            'inactive' => [['attribute' => 'Alt', 'value' => 'ja'], 'inactive'],
            'unknown attribute' => [['attribute' => 'länge', 'value' => '4,10 m'], 'No attribute with the key or name'],
            'unknown option' => [['value' => '5,00 m'], 'Valid options: 4,10 m, 3,60 m'],
            'bad number' => [['attribute' => 'Durchmesser', 'value' => '34abc'], 'must be a number'],
            'bad month' => [['attribute' => 'Fällzeitpunkt', 'value' => '2026-13'], 'must be a month'],
            'bad range' => [['--range' => '10-1'], 'is not a range'],
            'bad range list' => [['--range' => '1,abc'], 'is not a range'],
            'range beyond plaques' => [['--range' => '1-2000'], 'is not a range'],
        ];
        foreach ($cases as $name => [$input, $message]) {
            self::assertSame(Command::FAILURE, $this->set($input), $name);
            self::assertStringContainsString($message, $this->tester->getDisplay(), $name);
            self::assertSame(0, $this->events(), $name);
        }
    }

    public function testRangeIsRequired(): void
    {
        self::assertSame(Command::FAILURE, $this->tester->execute(['attribute' => 'Länge', 'value' => '4,10 m']));
        self::assertStringContainsString('--range is required', $this->tester->getDisplay());
    }
}
