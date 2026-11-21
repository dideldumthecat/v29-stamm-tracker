<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\Photo;
use App\Entity\Pile;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\KeyFigures\Dashboard;
use App\KeyFigures\KeyFigures;
use App\KeyFigures\MeasureLoader;
use App\KeyFigures\PileSections;
use App\Pile\PileEditor;
use App\Projection\TimberItemProjector;
use App\Report\TimberReport;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;

/**
 * GET /api/admin/dashboard. The fixture dashboard-response.json is the expectation for one stem of every kind:
 * split into beams (without the checkmark "sawn": the beams make it sawn), sawn whole, unsawable, sawn without diameter,
 * unprocessed, and a voided one that must not count. By diameter: 104 in 38–40, 105 in 32–34, 106 alone and unsawable in 30–32,
 * two empty classes between, 107 without diameter.
 */
class DashboardTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private User $user;
    /** @var array<string, Attribute> by key */
    private array $attribute = [];
    /** @var array<string, string> option id by label */
    private array $option = [];
    /** @var array<string, Uuid> by tag */
    private array $items = [];

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist($this->user = new User('Ada', UserRole::Admin, User::hashToken(User::normalizeToken('Ada-test-token'))));
        $this->em->persist(new User('Alexander', UserRole::Superadmin, User::hashToken(User::normalizeToken('Alexander-test-token'))));
        $this->em->persist(new User('Kerstin', UserRole::User, User::hashToken(User::normalizeToken('Kerstin-test-token'))));
        $definitions = [
            ['Durchmesser groß', 'mid_diameter_max', AttributeType::Number, []],
            ['Durchmesser klein', 'mid_diameter_min', AttributeType::Number, []],
            ['Länge', 'length', AttributeType::Choice, ['4,10 m']],
            ['Gesägt', 'sawn', AttributeType::Boolean, []],
            ['Nicht sägbar', 'unsawable', AttributeType::Boolean, []],
            ['Gesägter Querschnitt', 'sawn_cross_section', AttributeType::Choice, ['14,7 x 14,7 cm', '10,5 x 14,7 cm']],
            ['Polternummer', 'source', AttributeType::Choice, []],
            ['Notiz', 'notes', AttributeType::Text, []],
            ['Fotos', 'photos', AttributeType::Photo, []],
        ];
        foreach ($definitions as $order => [$name, $key, $type, $options]) {
            $inheritable = \in_array($key, ['length', 'sawn'], true);
            $this->em->persist($attribute = new Attribute($name, $type, isSeries: \in_array($key, ['notes', 'photos'], true), isInheritable: $inheritable, sortOrder: $order * 10, key: $key));
            $this->attribute[$key] = $attribute;
            foreach ($options as $label) {
                $this->em->persist($option = new AttributeOption($attribute, $label));
                $this->option[$label] = $option->id->toRfc4122();
            }
        }
    }

    /** @param array<string, mixed> $data */
    private function event(string $tag, EventType $type, array $data, string $at = '2026-11-19 10:54:00.250'): void
    {
        $when = new \DateTimeImmutable("$at UTC");
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $this->items[$tag], $type, $data, $when, $this->user, null, $when));
    }

    private function item(string $tag, ?string $stem = null, string $at = '2026-11-18 08:00:00'): Uuid
    {
        $this->items[$tag] = $id = Uuid::v7();
        $this->event($tag, EventType::Created, ['parent_id' => $stem ? $this->items[$stem]->toRfc4122() : null], $at);
        $this->event($tag, EventType::TagAssigned, ['tag_number' => $tag], $at);

        return $id;
    }

    /** @param array<string, mixed> $values by key; an option is given by its label */
    private function stem(string $tag, array $values, string $at = '2026-11-18 08:00:00'): void
    {
        $this->item($tag, at: $at);
        foreach ($values as $key => $value) {
            $this->event($tag, EventType::AttributeRecorded, ['attribute_id' => $this->attribute[$key]->id->toRfc4122(), 'value' => $this->option[$value] ?? $value], $at);
        }
    }

    private function everyKindOfStem(): void
    {
        // Split, the checkmark forgotten: round wood 0,502 fm, four beams 0,304 m³ (the worked example of the detail view)
        $this->stem('104', ['mid_diameter_max' => 40, 'mid_diameter_min' => 39, 'length' => '4,10 m']);
        foreach (['A' => '14,7 x 14,7 cm', 'B' => '14,7 x 14,7 cm', 'C' => '10,5 x 14,7 cm', 'D' => '10,5 x 14,7 cm'] as $letter => $section) {
            $this->item("104-$letter", '104');
            $this->event("104-$letter", EventType::AttributeRecorded, ['attribute_id' => $this->attribute['sawn_cross_section']->id->toRfc4122(), 'value' => $this->option[$section]], '2026-11-18 08:00:00');
        }
        // Sawn whole: round wood 0,339 fm, sawn timber 0,089 m³
        $this->stem('105', ['mid_diameter_max' => 34, 'mid_diameter_min' => 31, 'length' => '4,10 m', 'sawn' => true, 'sawn_cross_section' => '14,7 x 14,7 cm']);
        // Unsawable: round wood 0,290 fm, outside the yield
        $this->stem('106', ['mid_diameter_max' => 30, 'mid_diameter_min' => 30, 'length' => '4,10 m', 'unsawable' => true]);
        // Sawn without diameter: counts as processed, its sawn timber (0,063 m³) counts, its round wood cannot
        $this->stem('107', ['length' => '4,10 m', 'sawn' => true, 'sawn_cross_section' => '10,5 x 14,7 cm']);
        // Not processed
        $this->stem('108', ['mid_diameter_max' => 50, 'mid_diameter_min' => 50, 'length' => '4,10 m']);
        // Voided: counts nowhere; its void is the newest event
        $this->stem('109', ['mid_diameter_max' => 50, 'mid_diameter_min' => 50, 'length' => '4,10 m', 'sawn' => true, 'sawn_cross_section' => '14,7 x 14,7 cm']);
        $this->event('109', EventType::Voided, []);
    }

    /** @return array<string, mixed> */
    private static function fixture(): array
    {
        return json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/dashboard-response.json'), true, flags: \JSON_THROW_ON_ERROR);
    }

    /** @return array<string, mixed> */
    private function dashboard(string $as = 'Ada', int $status = 200): array
    {
        $this->em->flush();
        $projector = self::getContainer()->get(TimberItemProjector::class);
        foreach ($this->items as $item) {
            $projector->project($item);
        }
        $this->em->clear();
        $this->client->getCookieJar()->clear();
        if ('' !== $as) {
            $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
        }
        $this->client->request('GET', '/api/admin/dashboard');
        self::assertSame($status, $this->client->getResponse()->getStatusCode());

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    /**
     * @param array<string, mixed> $response
     *
     * @return array<string, array<string, mixed>> the figures of "sawing" by key
     */
    private static function sawing(array $response): array
    {
        return array_column($response['sections'][0]['figures'], null, 'key');
    }

    public function testEveryKindOfStemMatchesTheFixture(): void
    {
        $this->everyKindOfStem();

        $response = $this->dashboard();

        $fixture = self::fixture();
        self::assertSame($fixture['last_sync_at'], $response['last_sync_at']);
        self::assertEqualsWithDelta(\array_slice($fixture['sections'], 0, 2), $response['sections'], 1e-9, 'no stem has a pile: no pile cards');
        $figures = self::sawing($response);
        self::assertSame([5, 4, 1], [$figures['stems_total']['value'], $figures['stems_processed']['value'], $figures['stems_open']['value']]);
        $roundSawn = M_PI / 4 * (0.40 * 0.39 + 0.34 * 0.31) * 4.1;
        $roundUnsawable = M_PI / 4 * 0.30 * 0.30 * 4.1;
        $sawnTimber = (2 * 0.147 * 0.147 + 2 * 0.105 * 0.147 + 0.147 * 0.147 + 0.105 * 0.147) * 4.1;
        self::assertEqualsWithDelta($roundSawn + $roundUnsawable, $figures['round_wood']['value'], 1e-9);
        self::assertEqualsWithDelta($sawnTimber, $figures['sawn_timber']['value'], 1e-9);
        self::assertEqualsWithDelta($sawnTimber / $roundSawn, $figures['yield']['value'], 1e-9, 'the unsawable stem is not in the denominator');
        self::assertSame('3 gesägt + 1 nicht sägbar', $figures['stems_processed']['inserted'], 'the beams make 104 sawn');
        self::assertSame('Als gesägt zählt ein Stamm, wenn Gesägt angehakt ist, Balken vorhanden sind oder Gesägter Querschnitt erfasst ist. Bearbeitet sind außerdem Stämme mit Häkchen bei Nicht sägbar.', $figures['stems_processed']['formula']);
        self::assertStringNotContainsString('„', json_encode($response, \JSON_UNESCAPED_UNICODE), 'no quotation marks in the texts');
        self::assertSame('0,84 fm gesägt + 0,29 fm nicht sägbar', $figures['round_wood']['inserted']);
        self::assertStringContainsString('1 bearbeiteter Stamm ohne Durchmesser oder Länge fehlt in der Summe.', $figures['round_wood']['note']);
    }

    public function testAMissingPieceIsLeftOutAndNamed(): void
    {
        $this->stem('104', ['mid_diameter_max' => 40, 'mid_diameter_min' => 39, 'length' => '4,10 m', 'sawn' => true]);
        $this->item('104-A', '104');

        $figures = self::sawing($this->dashboard());

        self::assertSame(0, $figures['sawn_timber']['value']);
        self::assertSame('1 Stück ohne Querschnitt oder Länge fehlt in der Summe.', $figures['sawn_timber']['note']);
        self::assertSame(0, $figures['yield']['value']);
    }

    public function testBeamsAndACrossSectionMakeAStemSawnAndOnlySawnStemsGoIntoTheYield(): void
    {
        $this->stem('104', ['mid_diameter_max' => 40, 'mid_diameter_min' => 40, 'length' => '4,10 m']);
        $this->item('104-A', '104');
        $this->event('104-A', EventType::AttributeRecorded, ['attribute_id' => $this->attribute['sawn_cross_section']->id->toRfc4122(), 'value' => $this->option['14,7 x 14,7 cm']]);
        $this->stem('106', ['mid_diameter_max' => 30, 'mid_diameter_min' => 30, 'length' => '4,10 m', 'unsawable' => true]);
        // A cross-section without checkmark and without beams: sawn whole
        $this->stem('107', ['mid_diameter_max' => 30, 'mid_diameter_min' => 30, 'length' => '4,10 m', 'sawn_cross_section' => '10,5 x 14,7 cm']);
        $this->stem('108', ['mid_diameter_max' => 30, 'mid_diameter_min' => 30, 'length' => '4,10 m']);

        $figures = self::sawing($this->dashboard());

        self::assertSame([4, 3, 1], [$figures['stems_total']['value'], $figures['stems_processed']['value'], $figures['stems_open']['value']]);
        self::assertSame('2 gesägt + 1 nicht sägbar', $figures['stems_processed']['inserted']);
        $sawnTimber = (0.147 * 0.147 + 0.105 * 0.147) * 4.1;
        self::assertEqualsWithDelta($sawnTimber, $figures['sawn_timber']['value'], 1e-9);
        self::assertEqualsWithDelta($sawnTimber / (M_PI / 4 * (0.40 * 0.40 + 0.30 * 0.30) * 4.1), $figures['yield']['value'], 1e-9);
    }

    /** @return iterable<string, array{array<string, mixed>, bool, bool}> the values of stem 1, whether it has a beam, whether it is sawn */
    public static function sawnCases(): iterable
    {
        yield 'only the checkmark' => [['sawn' => true], false, true];
        yield 'only a beam' => [[], true, true];
        yield 'only a cross-section' => [['sawn_cross_section' => '14,7 x 14,7 cm'], false, true];
        yield 'none of them' => [['length' => '4,10 m'], false, false];
    }

    /** @param array<string, mixed> $values */
    #[DataProvider('sawnCases')]
    public function testDashboardAndExportCallTheSameStemSawn(array $values, bool $beam, bool $sawn): void
    {
        $this->stem('1', $values);
        if ($beam) {
            $this->item('1-A', '1');
        }

        $figures = self::sawing($this->dashboard());
        $sheet = self::getContainer()->get(TimberReport::class)->build(new \DateTimeImmutable())->stems;

        self::assertSame($sawn ? 1 : 0, $figures['stems_processed']['value']);
        self::assertSame($sawn ? '1 gesägt + 0 nicht sägbar' : '0 gesägt + 0 nicht sägbar', $figures['stems_processed']['inserted']);
        self::assertSame($sawn ? 'ja' : 'nein', array_combine($sheet->headers, $sheet->rows[0])['Gesägt']);
    }

    public function testTheLastSyncIsTheLaterOfEventAndPhotoUpload(): void
    {
        $item = $this->item('104');
        $this->event('104', EventType::AttributeRecorded, ['attribute_id' => $this->attribute['length']->id->toRfc4122(), 'value' => $this->option['4,10 m']]);
        // a reference: the request in between clears the entity manager
        $photo = fn (string $uploadedAt) => $this->em->persist(new Photo(Uuid::v7(), $item, $this->em->getReference(User::class, $this->user->id), 1000, str_repeat('0', 64), new \DateTimeImmutable('2026-11-19 10:00:00 UTC'), new \DateTimeImmutable("$uploadedAt UTC")));

        $photo('2026-11-19 10:00:00');
        self::assertSame('2026-11-19T10:54:00.250Z', $this->dashboard()['last_sync_at'], 'the event is later');

        $photo('2026-11-19 11:02:30.500');
        self::assertSame('2026-11-19T11:02:30.500Z', $this->dashboard()['last_sync_at'], 'the photo is later');
    }

    public function testWithoutEventsNothingIsCalculable(): void
    {
        $response = $this->dashboard();

        self::assertNull($response['last_sync_at']);
        $figures = self::sawing($response);
        self::assertSame([0, 0, 0], [$figures['stems_total']['value'], $figures['stems_processed']['value'], $figures['stems_open']['value']]);
        self::assertNull($figures['yield']['value']);
        self::assertNull($figures['yield']['inserted']);
    }

    public function testNeedsTheAdministrationRole(): void
    {
        $this->dashboard('', 401);
        $this->dashboard('Kerstin', 403);
        $this->dashboard('Ada');
        $this->dashboard('Alexander');
    }

    private function pile(string $id, string $label, int $order, string $number, ?string $location, ?string $latitude, ?string $longitude, ?string $volume): void
    {
        $this->em->persist($option = new AttributeOption($this->attribute['source'], $label, $order, id: Uuid::fromString($id)));
        $this->option[$label] = $option->id->toRfc4122();
        $this->em->persist(new Pile($option, $number, $location, $latitude, $longitude, $volume));
    }

    /** A stem of 45 × 44 cm and 4,10 m (0,652 fm) on a pile, with beams created in the week starting on $monday: [section, count] each. */
    private function sawnStem(string $tag, string $pile, string $monday, int $large, int $small): void
    {
        $at = "$monday 10:00:00";
        $this->stem($tag, ['mid_diameter_max' => 45, 'mid_diameter_min' => 44, 'length' => '4,10 m', 'source' => $pile], $at);
        foreach (range('A', chr(ord('A') + $large + $small - 1)) as $index => $letter) {
            $this->item("$tag-$letter", $tag, $at);
            $this->event("$tag-$letter", EventType::AttributeRecorded, ['attribute_id' => $this->attribute['sawn_cross_section']->id->toRfc4122(), 'value' => $this->option[$index < $large ? '14,7 x 14,7 cm' : '10,5 x 14,7 cm']], $at);
        }
    }

    /** @return array<string, mixed> */
    private function piles(): array
    {
        $a = '2601-010145 (Krummes F)';
        $b = '2601-010160 (Waldweg Nord)';
        $c = '2601-010170 (Lindenallee)';
        $this->pile('0199a000-0000-7000-8000-00000000a001', $a, 10, '2601-010145', 'Krummes F', '51.313200', '12.371500', '51.52');
        $this->pile('0199a000-0000-7000-8000-00000000a002', $b, 20, '2601-010160', 'Waldweg Nord', '51.320100', '12.402300', '130.00');
        $this->pile('0199a000-0000-7000-8000-00000000a003', $c, 30, '2601-010170', 'Lindenallee', null, null, null);

        // A: five weeks, one of them empty; one stem sawn whole, one unsawable, one open
        $this->sawnStem('201', $a, '2026-10-19', 2, 2);
        $this->sawnStem('202', $a, '2026-10-26', 3, 1);
        $this->sawnStem('203', $a, '2026-11-09', 4, 0);
        $this->sawnStem('204', $a, '2026-11-16', 1, 2);
        $this->stem('205', ['mid_diameter_max' => 40, 'mid_diameter_min' => 39, 'length' => '4,10 m', 'source' => $a, 'sawn' => true, 'sawn_cross_section' => '14,7 x 14,7 cm'], '2026-11-04 09:00:00');
        $this->stem('206', ['mid_diameter_max' => 30, 'mid_diameter_min' => 30, 'length' => '4,10 m', 'source' => $a, 'unsawable' => true]);
        $this->stem('207', ['mid_diameter_max' => 50, 'mid_diameter_min' => 50, 'length' => '4,10 m', 'source' => $a]);

        // B: sixteen weeks from 3 Aug, more than fit in a row; two stems of up to four beams each per week, one week without a beam
        $number = 300;
        for ($week = 0; $week < 16; ++$week) {
            $monday = (new \DateTimeImmutable('2026-08-03'))->modify("+$week weeks")->format('Y-m-d');
            [$large, $small] = 4 === $week ? [0, 0] : [2 + ($week * 5) % 7, ($week * 3) % 4];
            $first = min(4, $large + $small);
            if ($first > 0) {
                $this->sawnStem((string) ++$number, $b, $monday, min($large, 4), $first - min($large, 4));
            }
            if ($large + $small > 4) {
                $this->sawnStem((string) ++$number, $b, $monday, $large - min($large, 4), $small - ($first - min($large, 4)));
            }
        }
        $this->stem('390', ['mid_diameter_max' => 30, 'mid_diameter_min' => 30, 'length' => '4,10 m', 'source' => $b, 'unsawable' => true]);

        // C: nothing processed yet
        $this->stem('401', ['mid_diameter_max' => 38, 'mid_diameter_min' => 38, 'length' => '4,10 m', 'source' => $c]);
        $this->stem('402', ['mid_diameter_max' => 42, 'mid_diameter_min' => 41, 'length' => '4,10 m', 'source' => $c]);
        // Without a pile: on no card
        $this->stem('410', ['mid_diameter_max' => 42, 'mid_diameter_min' => 41, 'length' => '4,10 m', 'sawn' => true, 'sawn_cross_section' => '14,7 x 14,7 cm']);

        return $this->build();
    }

    /** @return array<string, mixed> the dashboard on Saturday 21 Nov 2026 (the current week is KW 47, from Monday 16 Nov) */
    private function build(): array
    {
        $this->em->flush();
        $projector = self::getContainer()->get(TimberItemProjector::class);
        foreach ($this->items as $item) {
            $projector->project($item);
        }
        $this->em->clear();
        $kf = new KeyFigures();
        $dashboard = new Dashboard($this->em, new MeasureLoader($this->em), $kf, new PileEditor($this->em), new PileSections($kf));

        return $dashboard->build(new \DateTimeImmutable('2026-11-21 12:00:00 Europe/Berlin'));
    }

    public function testPileCardsMatchTheFixture(): void
    {
        $sections = $this->piles()['sections'];

        self::assertEqualsWithDelta(\array_slice(self::fixture()['sections'], 2), \array_slice($sections, 2), 1e-9);
        self::assertSame(['Polter 2601-010145 (Krummes F)', 'Polter 2601-010160 (Waldweg Nord)', 'Polter 2601-010170 (Lindenallee)'], array_column(\array_slice($sections, 2), 'label'));
        self::assertSame([5, 16, 0], array_map(static fn (array $pile) => \count($pile['weeks']), \array_slice($sections, 2)));
        self::assertStringNotContainsString('„', json_encode($sections, \JSON_UNESCAPED_UNICODE));
    }

    /**
     * @param list<array{string, string, mixed}> $events when (UTC), the attribute key and the value, in the order they reach the server
     *
     * @return list<array{string, int, int}> the weeks of the only pile: start, large, small
     */
    private function weeksOfAStemSawnWhole(array $events): array
    {
        $this->pile('0199a000-0000-7000-8000-00000000a001', 'P', 10, '1', null, null, null, null);
        $this->stem('501', ['mid_diameter_max' => 40, 'mid_diameter_min' => 40, 'length' => '4,10 m', 'source' => 'P'], '2026-10-01 08:00:00');
        foreach ($events as [$at, $key, $value]) {
            $this->event('501', EventType::AttributeRecorded, ['attribute_id' => $this->attribute[$key]->id->toRfc4122(), 'value' => $this->option[$value] ?? $value], $at);
        }

        $pile = $this->build()['sections'][2];

        return array_map(static fn (array $week) => [$week['week_start'], $week['large'], $week['small']], $pile['weeks']);
    }

    public function testAStemSawnWholeCountsInTheWeekSawnWasFirstSetToYes(): void
    {
        // KW 45 yes, KW 47 yes again; the cross-section comes in KW 47 as well
        $weeks = $this->weeksOfAStemSawnWhole([
            ['2026-11-03 09:00:00', 'sawn', true],
            ['2026-11-17 09:00:00', 'sawn', true],
            ['2026-11-17 09:05:00', 'sawn_cross_section', '14,7 x 14,7 cm'],
        ]);

        self::assertSame([['2026-11-02', 1, 0], ['2026-11-09', 0, 0], ['2026-11-16', 0, 0]], $weeks);
    }

    public function testALaterNoDoesNotMoveTheWeekOfTheFirstYes(): void
    {
        // KW 45 yes, KW 46 no, KW 47 yes
        $weeks = $this->weeksOfAStemSawnWhole([
            ['2026-11-03 09:00:00', 'sawn', true],
            ['2026-11-10 09:00:00', 'sawn', false],
            ['2026-11-17 09:00:00', 'sawn', true],
            ['2026-11-17 09:05:00', 'sawn_cross_section', '10,5 x 14,7 cm'],
        ]);

        self::assertSame([['2026-11-02', 0, 1], ['2026-11-09', 0, 0], ['2026-11-16', 0, 0]], $weeks);
    }

    public function testWithoutAYesTheWeekIsTheOneOfTheCrossSection(): void
    {
        $weeks = $this->weeksOfAStemSawnWhole([
            ['2026-11-03 09:00:00', 'sawn', false],
            ['2026-11-10 09:00:00', 'sawn_cross_section', '14,7 x 14,7 cm'],
        ]);

        self::assertSame([['2026-11-09', 1, 0], ['2026-11-16', 0, 0]], $weeks);
    }
}
