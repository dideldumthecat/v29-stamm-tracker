<?php

namespace App\Tests\Report;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use App\Report\Report;
use App\Report\Sheet;
use App\Report\TimberReport;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Uid\Uuid;

class TimberReportTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private User $user;
    /** @var array<string, Attribute> by key */
    private array $attribute = [];
    /** @var array<string, string> option id by label */
    private array $option = [];
    /** @var list<Uuid> */
    private array $items = [];

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist($this->user = new User('Kerstin', UserRole::User, User::hashToken('t')));
    }

    /** Attributes as in data/attributes.yaml, plus one that is not inherited. */
    private function attributes(string ...$except): void
    {
        $definitions = [
            ['Holzart', null, AttributeType::Choice, true, ['Stieleiche']],
            ['Durchmesser groß', 'mid_diameter_max', AttributeType::Number, true, []],
            ['Durchmesser klein', 'mid_diameter_min', AttributeType::Number, true, []],
            ['Länge', 'length', AttributeType::Choice, true, ['4,10 m', '3,60 m', 'etwa vier Meter']],
            ['Gesägt', 'sawn', AttributeType::Boolean, true, []],
            ['Querschnitt', 'sawn_cross_section', AttributeType::Choice, false, ['14,7 x 14,7 cm', '10,5 x 14,7 cm', 'quadratisch']],
            ['Entrindet', null, AttributeType::Boolean, false, []],
            ['Notiz', 'notes', AttributeType::Text, false, []],
            ['Fotos', 'photos', AttributeType::Photo, false, []],
        ];
        foreach ($definitions as $order => [$name, $key, $type, $inheritable, $options]) {
            if (\in_array($key, $except, true)) {
                continue;
            }
            $this->em->persist($attribute = new Attribute($name, $type, isSeries: \in_array($key, ['notes', 'photos'], true), isInheritable: $inheritable, sortOrder: $order * 10, key: $key));
            $this->attribute[$key ?? $name] = $attribute;
            foreach ($options as $label) {
                $this->em->persist($option = new AttributeOption($attribute, $label));
                $this->option[$label] = $option->id->toRfc4122();
            }
        }
    }

    private function event(Uuid $item, EventType $type, array $data): void
    {
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, $type, $data, new \DateTimeImmutable('2026-10-20 08:00:00 UTC'), $this->user, null, new \DateTimeImmutable('2026-10-20 08:00:00 UTC')));
    }

    private function item(string $tag, ?Uuid $parent = null): Uuid
    {
        $this->items[] = $id = Uuid::v7();
        $this->event($id, EventType::Created, ['parent_id' => $parent?->toRfc4122()]);
        $this->event($id, EventType::TagAssigned, ['tag_number' => $tag]);

        return $id;
    }

    /** An option is given by its label. */
    private function record(Uuid $item, string $key, mixed $value): void
    {
        $this->event($item, EventType::AttributeRecorded, ['attribute_id' => $this->attribute[$key]->id->toRfc4122(), 'value' => $this->option[$value] ?? $value]);
    }

    private function build(): Report
    {
        $this->em->flush();
        $projector = self::getContainer()->get(TimberItemProjector::class);
        foreach ($this->items as $id) {
            $projector->project($id);
        }
        $this->em->clear();

        return self::getContainer()->get(TimberReport::class)->build(new \DateTimeImmutable('2026-11-02 12:00:00 UTC'));
    }

    /** @return array<string, array<string, mixed>> cells by tag and heading */
    private function table(Sheet $sheet): array
    {
        $table = [];
        foreach ($sheet->rows as $row) {
            $table[$row[0]] = array_combine($sheet->headers, $row);
        }

        return $table;
    }

    public function testABeamInheritsInheritableValuesAndItsOwnValueWins(): void
    {
        $this->attributes();
        $stem = $this->item('12');
        $this->record($stem, 'Holzart', 'Stieleiche');
        $this->record($stem, 'length', '4,10 m');
        $this->record($stem, 'Entrindet', true);
        $inheriting = $this->item('12-A', $stem);
        $own = $this->item('12-B', $stem);
        $this->record($own, 'length', '3,60 m');
        $this->record($inheriting, 'sawn_cross_section', '14,7 x 14,7 cm');
        $this->record($own, 'sawn_cross_section', '14,7 x 14,7 cm');

        $beams = $this->table($this->build()->beams);

        self::assertSame('Stieleiche', $beams['00012-A']['Holzart']);
        self::assertSame(4.1, $beams['00012-A']['Länge (m)']);
        self::assertSame(3.6, $beams['00012-B']['Länge (m)']);
        self::assertNull($beams['00012-A']['Entrindet'], 'not inheritable');
        self::assertEqualsWithDelta(0.147 * 0.147 * 3.6, $beams['00012-B']['Schnittholz (m³)'], 1e-9);
    }

    public function testWholeSawnStemIsOnBothSheetsAndUnsawnOnlyOnStems(): void
    {
        $this->attributes();
        $whole = $this->item('5');
        $this->record($whole, 'length', '4,10 m');
        $this->record($whole, 'sawn_cross_section', '14,7 x 14,7 cm');
        $this->item('6');

        $report = $this->build();

        $stems = $this->table($report->stems);
        self::assertSame(1, $stems['00005']['Anzahl Balken']);
        self::assertSame(0, $stems['00006']['Anzahl Balken']);
        self::assertEqualsWithDelta(0.147 * 0.147 * 4.1, $stems['00005']['Schnittholz (m³)'], 1e-9);
        self::assertNull($stems['00006']['Schnittholz (m³)']);
        $beams = $this->table($report->beams);
        self::assertSame(['00005'], array_keys($beams));
        self::assertSame('00005', $beams['00005']['Stamm']);
    }

    public function testSawnIsDerivedFromBeamsCrossSectionOrCheckmark(): void
    {
        $this->attributes();
        $withBeam = $this->item('1');
        $this->item('1-A', $withBeam);
        $this->record($this->item('2'), 'sawn_cross_section', '14,7 x 14,7 cm');
        $this->record($this->item('3'), 'sawn', true);
        $this->record($this->item('4'), 'sawn', false);
        $this->item('5');

        $report = $this->build();

        self::assertSame(
            ['00001' => 'ja', '00002' => 'ja', '00003' => 'ja', '00004' => 'nein', '00005' => 'nein'],
            array_map(static fn (array $row) => $row['Gesägt'], $this->table($report->stems)),
        );
        self::assertSame(['00001-A', '00002', '00003'], array_keys($this->table($report->beams)));
        self::assertNotContains('Gesägt', $report->beams->headers);
        self::assertNotContains('Durchmesser groß (cm)', $report->beams->headers);
    }

    public function testDiameterZeroMeansNotMeasured(): void
    {
        $this->attributes();
        $stem = $this->item('7');
        $this->record($stem, 'mid_diameter_max', 0);
        $this->record($stem, 'mid_diameter_min', 31);
        $this->record($stem, 'length', '4,10 m');

        $row = $this->table($this->build()->stems)['00007'];

        self::assertNull($row['Durchmesser groß (cm)']);
        self::assertSame(31.0, $row['Durchmesser klein (cm)']);
        self::assertNull($row['Rundholz (fm)']);
    }

    public function testABeamWithoutCrossSectionLeavesSawnVolumeAndYieldOfTheStemEmpty(): void
    {
        $this->attributes();
        $stem = $this->item('8');
        $this->record($stem, 'mid_diameter_max', 34);
        $this->record($stem, 'mid_diameter_min', 31);
        $this->record($stem, 'length', '4,10 m');
        $this->record($this->item('8-A', $stem), 'sawn_cross_section', '14,7 x 14,7 cm');
        $this->item('8-B', $stem);

        $report = $this->build();

        $row = $this->table($report->stems)['00008'];
        self::assertSame(2, $row['Anzahl Balken']);
        self::assertNotNull($row['Rundholz (fm)']);
        self::assertNull($row['Schnittholz (m³)']);
        self::assertNull($row['Ausbeute']);
        $beams = $this->table($report->beams);
        self::assertNotNull($beams['00008-A']['Schnittholz (m³)']);
        self::assertNull($beams['00008-B']['Schnittholz (m³)'], 'sawn without cross-section stays as a row');
    }

    public function testWorkedExample(): void
    {
        $this->attributes();
        $stem = $this->item('34');
        $this->record($stem, 'mid_diameter_max', 34);
        $this->record($stem, 'mid_diameter_min', 31);
        $this->record($stem, 'length', '4,10 m');
        foreach (['34-A' => '14,7 x 14,7 cm', '34-B' => '14,7 x 14,7 cm', '34-C' => '10,5 x 14,7 cm'] as $tag => $section) {
            $this->record($this->item($tag, $stem), 'sawn_cross_section', $section);
        }

        $row = $this->table($this->build()->stems)['00034'];

        self::assertEqualsWithDelta(0.339, $row['Rundholz (fm)'], 0.0005);
        self::assertEqualsWithDelta(0.240, $row['Schnittholz (m³)'], 0.0005);
        self::assertEqualsWithDelta(0.71, $row['Ausbeute'], 0.005);
        self::assertSame('71 %', Sheet::displayed($row['Ausbeute'], '0 %'));
    }

    public function testNotesPhotosAndTimes(): void
    {
        $this->attributes();
        $stem = $this->item('9');
        $this->record($stem, 'notes', 'erste');
        $this->record($stem, 'notes', 'zweite');
        $this->record($stem, 'photos', 'p1');
        $this->record($stem, 'photos', 'p2');
        $beam = $this->item('9-A', $stem);

        $report = $this->build();

        $row = $this->table($report->stems)['00009'];
        self::assertSame("erste\nzweite", $row['Notiz']);
        self::assertSame([2, 'p1, p2'], [$row['Anzahl Fotos'], $row['Foto-IDs']]);
        self::assertSame('Kerstin', $row['Angelegt von']);
        self::assertSame('2026-10-20 10:00', $row['Angelegt am']->format('Y-m-d H:i'), 'Europe/Berlin');
        self::assertSame('Stand: 02.11.2026 13:00', 'Stand: '.$report->exportedAt->format('d.m.Y H:i'));
        self::assertNull($this->table($report->beams)['00009-A']['Notiz'], 'only the own notes');
        self::assertSame(0, $this->table($report->beams)['00009-A']['Anzahl Fotos']);
        self::assertNotNull($beam);
    }

    public function testLastChangedByIsTheAuthorOfTheLastOwnEvent(): void
    {
        $this->attributes();
        $this->em->persist($anna = new User('Anna', UserRole::User, User::hashToken('a')));
        $stem = $this->item('30');
        $beam = $this->item('30-A', $stem);
        $tie = $this->item('31');
        $none = $this->item('32');
        $late = new \DateTimeImmutable('2026-10-21 08:00:00 UTC');
        $attribute = $this->attribute['notes']->id->toRfc4122();
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $stem, EventType::AttributeRecorded, ['attribute_id' => $attribute, 'value' => 'x'], $late, $anna, null, $late));
        // Same received_at: the event with the higher id wins, as in the projections.
        $this->em->persist(new TimberItemEvent(Uuid::fromString('00000000-0000-7000-8000-000000000001'), $tie, EventType::AttributeRecorded, ['attribute_id' => $attribute, 'value' => 'a'], $late, $this->user, null, $late));
        $this->em->persist(new TimberItemEvent(Uuid::fromString('00000000-0000-7000-8000-000000000002'), $tie, EventType::AttributeRecorded, ['attribute_id' => $attribute, 'value' => 'b'], $late, $anna, null, $late));

        $report = $this->build();

        $stems = $this->table($report->stems);
        self::assertSame(['Anna', '2026-10-21 10:00'], [$stems['00030']['Zuletzt geändert von'], $stems['00030']['Zuletzt geändert am']->format('Y-m-d H:i')]);
        self::assertSame('Anna', $stems['00031']['Zuletzt geändert von']);
        self::assertSame('Kerstin', $this->table($report->beams)['00030-A']['Zuletzt geändert von'], 'own events only');
        self::assertNotNull($beam);
        self::assertNotNull($none);
    }

    public function testClosingColumnsHaveTheSameOrderOnBothSheets(): void
    {
        $this->attributes();
        $this->item('33');

        $report = $this->build();

        $closing = ['Notiz', 'Angelegt am', 'Angelegt von', 'Zuletzt geändert am', 'Zuletzt geändert von', 'Anzahl Fotos', 'Foto-IDs'];
        foreach ([$report->stems, $report->beams] as $sheet) {
            self::assertSame($closing, \array_slice($sheet->headers, -\count($closing)));
        }
        self::assertSame($closing, array_slice(array_column(array_filter($report->notes->rows, static fn (array $row) => 'Balken' === $row[0]), 1), -\count($closing)));
    }

    public function testVoidedItemsAreMissing(): void
    {
        $this->attributes();
        $stem = $this->item('10');
        $beam = $this->item('10-A', $stem);
        $voided = $this->item('11');
        $this->event($voided, EventType::Voided, []);
        $this->record($this->item('13'), 'sawn', true);
        $this->em->flush();
        $this->event($beam, EventType::Voided, []);

        $report = $this->build();

        self::assertSame(['00010', '00013'], array_keys($this->table($report->stems)));
        self::assertSame(['00013'], array_keys($this->table($report->beams)));
    }

    public function testUnreadableOptionTextLeavesCellEmptyAndWarns(): void
    {
        $this->attributes();
        $stem = $this->item('14');
        $this->record($stem, 'length', 'etwa vier Meter');
        $this->record($stem, 'sawn_cross_section', 'quadratisch');

        $report = $this->build();

        $row = $this->table($report->stems)['00014'];
        self::assertNull($row['Länge (m)']);
        self::assertNull($this->table($report->beams)['00014']['Breite (cm)']);
        self::assertSame([
            'Unreadable value left empty: 00014, Länge, "etwa vier Meter"',
            'Unreadable value left empty: 00014, Querschnitt, "quadratisch"',
        ], $report->warnings);
    }

    public function testAnInactiveAttributeIsListedOnlyWhileAnItemHasAValueForIt(): void
    {
        $this->attributes();
        $this->em->persist($this->attribute['Alt'] = new Attribute('Alt', AttributeType::Text, isInheritable: true, sortOrder: 1000, active: false));
        $this->em->persist($this->attribute['Leer'] = new Attribute('Leer', AttributeType::Text, sortOrder: 1010, active: false));
        $stem = $this->item('16');
        $this->record($stem, 'Alt', 'früher erfasst');
        $this->item('16-A', $stem);
        $this->event($removed = $this->item('17'), EventType::Voided, []);
        $this->record($removed, 'Leer', 'nur am entfernten Stamm');

        $report = $this->build();

        self::assertContains('Alt', $report->stems->headers);
        self::assertNotContains('Leer', $report->stems->headers);
        self::assertSame('früher erfasst', $this->table($report->stems)['00016']['Alt']);
        self::assertSame('früher erfasst', $this->table($report->beams)['00016-A']['Alt'], 'inherited');
        self::assertNotContains('Leer', $report->beams->headers);
        $meanings = array_column(array_filter($report->notes->rows, static fn (array $row) => 'Alt' === $row[1]), 2);
        self::assertCount(2, $meanings);
        self::assertStringContainsString('inaktives Merkmal', $meanings[0]);
    }

    public function testNotesSayWhereABeamValueComesFrom(): void
    {
        $this->attributes();

        $meanings = [];
        foreach ($this->build()->notes->rows as [$category, $heading, $meaning]) {
            $meanings[$category][$heading] = $meaning;
        }

        self::assertSame('Wert des Balkens, sonst vom Stamm geerbt', $meanings['Balken']['Holzart']);
        self::assertSame('Erfasster Wert des Merkmals', $meanings['Stämme']['Holzart']);
        self::assertSame('Erfasster Wert des Merkmals', $meanings['Balken']['Entrindet'], 'not inheritable');
        self::assertContains('Entfernte Einträge fehlen. Alle Zahlen sind feste Werte, keine Excel-Formeln.', array_column($this->build()->notes->rows, 2));
    }

    public function testPhotoIdsAreTheLastColumnAndNeverWrap(): void
    {
        $this->attributes();
        $stem = $this->item('18');
        foreach (range(1, 5) as $number) {
            $this->record($stem, 'photos', Uuid::v4()->toRfc4122());
        }
        $this->record($stem, 'notes', str_repeat('lang ', 20));

        $report = $this->build();

        foreach ([$report->stems, $report->beams] as $sheet) {
            self::assertSame([array_key_last($sheet->headers)], $sheet->unwrapped);
            self::assertSame('Foto-IDs', $sheet->headers[$sheet->unwrapped[0]]);
        }
        self::assertSame(50.0, $report->stems->columnWidths()[array_key_last($report->stems->headers)], 'width capped, text runs over');
        self::assertNotContains(array_search('Notiz', $report->stems->headers), $report->stems->unwrapped);
    }

    public function testMissingKeyAborts(): void
    {
        $this->attributes('sawn', 'photos');
        $this->em->flush();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/Missing in the database: sawn, photos\./');
        self::getContainer()->get(TimberReport::class)->build(new \DateTimeImmutable());
    }

    public function testRenamedAttributeChangesTheHeadingNotTheCalculation(): void
    {
        $this->attributes();
        $this->attribute['length']->name = 'Stammlänge';
        $this->attribute['sawn_cross_section']->name = 'Schnittmaß';
        $stem = $this->item('15');
        $this->record($stem, 'mid_diameter_max', 34);
        $this->record($stem, 'mid_diameter_min', 31);
        $this->record($stem, 'length', '4,10 m');

        $report = $this->build();

        self::assertContains('Stammlänge (m)', $report->stems->headers);
        self::assertContains('Schnittmaß', $report->beams->headers);
        self::assertNotContains('Länge (m)', $report->stems->headers);
        self::assertEqualsWithDelta(0.339, $this->table($report->stems)['00015']['Rundholz (fm)'], 0.0005);
        $meanings = implode("\n", array_column($report->notes->rows, 2));
        self::assertStringContainsString('„Stammlänge“', $meanings);
        self::assertStringContainsString('„Schnittmaß“', $meanings);
    }

    public function testColumnWidthFollowsTheLongestDisplayedContentWithinLimits(): void
    {
        $date = new \DateTimeImmutable('2026-10-20 10:00');
        $sheet = new Sheet('x', ['Kurz', 'Zuletzt geändert am', 'Text', 'Lang', 'Länge', 'Ausbeute'], [null, 'dd.mm.yyyy hh:mm', null, null, '0.00', '0 %'], [
            ['abcdefghij', $date, "kurz\nmittellang eine Zeile", str_repeat('x', 80), 4.1, 0.71],
            ['a', null, 'b', 'c', 12.345, 1.0],
        ]);

        self::assertSame([12.0, 18.0, 23.0, 50.0, 7.0, 10.0], $sheet->columnWidths());
        // Heading only: longest word "geändert" (8) + 2, but at least 6.
        self::assertSame([6.0, 10.0], (new Sheet('y', ['Ab', 'Zuletzt geändert am'], [null, null], []))->columnWidths());
    }
}
