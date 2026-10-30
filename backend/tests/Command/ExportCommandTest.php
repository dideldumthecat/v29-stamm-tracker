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
use OpenSpout\Reader\XLSX\Reader;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Uid\Uuid;

class ExportCommandTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private User $user;
    private string $file;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->file = tempnam(sys_get_temp_dir(), 'export').'.xlsx';
        $this->tester = new CommandTester((new Application($kernel))->find('app:export'));
        $this->em->persist($this->user = new User('Kerstin', UserRole::User, User::hashToken('t')));
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
        parent::tearDown();
    }

    private CommandTester $tester;

    private function attribute(string $name, AttributeType $type, int $sortOrder, bool $inheritable = false, bool $series = false, bool $active = true): Attribute
    {
        $this->em->persist($attribute = new Attribute($name, $type, isSeries: $series, isInheritable: $inheritable, sortOrder: $sortOrder, active: $active));

        return $attribute;
    }

    private function event(Uuid $item, EventType $type, array $data, string $receivedAt = '2026-10-20 08:00:00'): void
    {
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, $type, $data, new \DateTimeImmutable('2026-10-20 08:00:00 UTC'), $this->user, null, new \DateTimeImmutable($receivedAt.' UTC')));
    }

    private function item(string $tag, ?Uuid $parent = null, string $receivedAt = '2026-10-20 08:00:00'): Uuid
    {
        $id = Uuid::v7();
        $this->event($id, EventType::Created, ['parent_id' => $parent?->toRfc4122()], $receivedAt);
        $this->event($id, EventType::TagAssigned, ['tag_number' => $tag], $receivedAt);

        return $id;
    }

    private function record(Uuid $item, Attribute $attribute, mixed $value, string $receivedAt = '2026-10-20 08:00:00'): void
    {
        $this->event($item, EventType::AttributeRecorded, ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $value], $receivedAt);
    }

    /** @return list<list<mixed>> cell values per row, header first */
    private function exported(): array
    {
        $reader = new Reader();
        $reader->open($this->file);
        $rows = [];
        foreach ($reader->getSheetIterator() as $sheet) {
            foreach ($sheet->getRowIterator() as $row) {
                $rows[] = $row->toArray();
            }
        }
        $reader->close();

        return $rows;
    }

    public function testWritesCurrentStateOneRowPerItemWithAttributeColumns(): void
    {
        $species = $this->attribute('Holzart', AttributeType::Choice, 10, inheritable: true);
        $this->em->persist($stieleiche = new AttributeOption($species, 'Stieleiche'));
        $diameter = $this->attribute('Durchmesser', AttributeType::Number, 20, inheritable: true);
        $sawn = $this->attribute('Gesägt', AttributeType::Boolean, 30);
        $note = $this->attribute('Notiz', AttributeType::Text, 40, series: true);
        $felled = $this->attribute('Fälldatum', AttributeType::Date, 50);
        $month = $this->attribute('Fällzeitpunkt', AttributeType::Month, 60);
        $old = $this->attribute('Alt', AttributeType::Text, 70, active: false);
        $this->attribute('Veraltet', AttributeType::Text, 80, active: false);

        $stem = $this->item('12');
        $this->record($stem, $species, $stieleiche->id->toRfc4122());
        $this->record($stem, $diameter, 31);
        $this->record($stem, $sawn, true);
        $this->record($stem, $note, 'erste Notiz');
        $this->record($stem, $note, 'zweite Notiz');
        $this->record($stem, $felled, '2026-09-28');
        $this->record($stem, $month, '2026-09');
        $this->record($stem, $old, 'Ältere Angabe');
        $beam = $this->item('12-A', $stem);
        $this->record($beam, $diameter, 25, '2026-10-21 09:30:00');
        $early = $this->item('3', receivedAt: '2026-10-19 07:00:00');
        $voided = $this->item('99');
        $this->event($voided, EventType::Voided, []);
        $this->em->flush();
        $projector = self::getContainer()->get(TimberItemProjector::class);
        foreach ([$stem, $beam, $early, $voided] as $id) {
            $projector->project($id);
        }

        $this->tester->execute(['file' => $this->file]);

        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertStringContainsString($this->file.': 3 rows.', $this->tester->getDisplay());
        $rows = $this->exported();
        self::assertSame(
            ['Kennung', 'Typ', 'Stamm', 'Angelegt am', 'Angelegt von', 'Zuletzt geändert am', 'Holzart', 'Durchmesser', 'Gesägt', 'Notiz', 'Fälldatum', 'Fällzeitpunkt', 'Alt'],
            $rows[0],
        );

        // Sorted by number, the beam right below its stem; the voided item is missing.
        self::assertSame(['00003', '00012', '00012-A'], array_column(\array_slice($rows, 1), 0));

        [$early, $stem, $beam] = \array_slice($rows, 1);
        self::assertSame(['00003', 'Stamm', null, 'Kerstin'], [$early[0], $early[1], $early[2] ?: null, $early[4]]);
        self::assertSame(['Balken', '00012'], [$beam[1], $beam[2]]);

        // Times as date cells in Europe/Berlin (CEST, UTC+2), the last received event as last change.
        self::assertInstanceOf(\DateTimeImmutable::class, $stem[3]);
        self::assertSame('2026-10-20 10:00', $stem[3]->format('Y-m-d H:i'));
        self::assertSame('2026-10-20 10:00', $stem[5]->format('Y-m-d H:i'));
        self::assertSame('2026-10-21 11:30', $beam[5]->format('Y-m-d H:i'));

        // Stem: choice as option text, number as number, yes/no, series joined, date as date cell, month and old value.
        self::assertSame(['Stieleiche', 31, 'ja', 'erste Notiz | zweite Notiz'], \array_slice($stem, 6, 4));
        self::assertSame('2026-09-28', $stem[10]->format('Y-m-d'));
        self::assertSame(['2026-09', 'Ältere Angabe'], \array_slice($stem, 11, 2));

        // Beam: inherited choice, own number wins, everything else empty.
        self::assertSame('Stieleiche', $beam[6]);
        self::assertSame(25, $beam[7]);
        self::assertSame([null, null, null, null, null], array_map(static fn ($value) => '' === $value ? null : $value, \array_slice($beam, 8, 5)));
    }

    public function testDefaultFileNameInCurrentDirectory(): void
    {
        $directory = sys_get_temp_dir().'/export-'.bin2hex(random_bytes(4));
        mkdir($directory);
        $previous = getcwd();
        chdir($directory);
        try {
            $this->tester->execute([]);
            $files = glob($directory.'/*');
        } finally {
            chdir($previous);
        }

        self::assertSame(Command::SUCCESS, $this->tester->getStatusCode());
        self::assertCount(1, $files);
        self::assertMatchesRegularExpression('/stamm-tracker-export-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/', $files[0]);
        unlink($files[0]);
        rmdir($directory);
    }

    public function testAClearedAttributeIsEmpty(): void
    {
        $diameter = $this->attribute('Durchmesser', AttributeType::Number, 10, inheritable: true);
        $stem = $this->item('12');
        $this->record($stem, $diameter, 31);
        $this->em->flush();
        $recording = $this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE type = ?', ['attribute_recorded']);
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $stem, EventType::Voided, [], new \DateTimeImmutable('2026-10-21 08:00:00 UTC'), $this->user, Uuid::fromBinary($recording), new \DateTimeImmutable('2026-10-21 08:00:00 UTC')));
        $this->em->flush();
        self::getContainer()->get(TimberItemProjector::class)->project($stem);

        $this->tester->execute(['file' => $this->file]);

        $rows = $this->exported();
        self::assertCount(2, $rows, 'the stem is still listed');
        self::assertSame(['00012', 'Stamm'], [$rows[1][0], $rows[1][1]]);
        self::assertEmpty($rows[1][6] ?? null);
    }
}
