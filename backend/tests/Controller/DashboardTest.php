<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\Photo;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
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
 * unprocessed, and a voided one that must not count.
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

    private function item(string $tag, ?string $stem = null): Uuid
    {
        $this->items[$tag] = $id = Uuid::v7();
        $this->event($tag, EventType::Created, ['parent_id' => $stem ? $this->items[$stem]->toRfc4122() : null], '2026-11-18 08:00:00');
        $this->event($tag, EventType::TagAssigned, ['tag_number' => $tag], '2026-11-18 08:00:00');

        return $id;
    }

    /** @param array<string, mixed> $values by key; an option is given by its label */
    private function stem(string $tag, array $values): void
    {
        $this->item($tag);
        foreach ($values as $key => $value) {
            $this->event($tag, EventType::AttributeRecorded, ['attribute_id' => $this->attribute[$key]->id->toRfc4122(), 'value' => $this->option[$value] ?? $value], '2026-11-18 08:00:00');
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

        self::assertEqualsWithDelta(json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/dashboard-response.json'), true, flags: \JSON_THROW_ON_ERROR), $response, 1e-9);
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
}
