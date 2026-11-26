<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use App\Report\TimberReport;
use App\Tests\Support\Groups;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;

/**
 * GET /api/admin/timber-items/{id}/key-figures. The fixture key-figures-response.json is the expectation for the worked example
 * (stem 40 × 39 cm, 4,10 m, four beams); the export has to show the same numbers.
 */
class KeyFiguresTest extends WebTestCase
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
        $this->em->persist($this->user = new User('Ada', UserRole::Admin, Groups::v29($this->em), User::hashToken(User::normalizeToken('Ada-test-token'))));
        $this->em->persist(new User('Kerstin', UserRole::User, Groups::v29($this->em), User::hashToken(User::normalizeToken('Kerstin-test-token'))));
        $definitions = [
            ['Durchmesser groß', 'mid_diameter_max', AttributeType::Number, []],
            ['Durchmesser klein', 'mid_diameter_min', AttributeType::Number, []],
            ['Länge', 'length', AttributeType::Choice, ['4,10 m']],
            ['Gesägt', 'sawn', AttributeType::Boolean, []],
            ['Querschnitt', 'sawn_cross_section', AttributeType::Choice, ['14,7 x 14,7 cm', '10,5 x 14,7 cm']],
            ['Notiz', 'notes', AttributeType::Text, []],
            ['Fotos', 'photos', AttributeType::Photo, []],
        ];
        foreach ($definitions as $order => [$name, $key, $type, $options]) {
            $this->em->persist($attribute = new Attribute($name, $type, isSeries: \in_array($key, ['notes', 'photos'], true), isInheritable: !\in_array($key, ['sawn_cross_section', 'notes', 'photos'], true), sortOrder: $order * 10, key: $key));
            $this->attribute[$key] = $attribute;
            foreach ($options as $label) {
                $this->em->persist($option = new AttributeOption($attribute, $label));
                $this->option[$label] = $option->id->toRfc4122();
            }
        }
    }

    /** @param array<string, mixed> $data */
    private function event(string $tag, EventType $type, array $data): void
    {
        $when = new \DateTimeImmutable('2026-10-20 08:00:00 UTC');
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $this->items[$tag], $type, $data, $when, $this->user, null, $when));
    }

    private function item(string $tag, ?string $stem = null): void
    {
        $this->items[$tag] = Uuid::v7();
        $this->event($tag, EventType::Created, ['parent_id' => $stem ? $this->items[$stem]->toRfc4122() : null]);
        $this->event($tag, EventType::TagAssigned, ['tag_number' => $tag]);
    }

    private function record(string $tag, string $key, mixed $value): void
    {
        $this->event($tag, EventType::AttributeRecorded, ['attribute_id' => $this->attribute[$key]->id->toRfc4122(), 'value' => $this->option[$value] ?? $value]);
    }

    /** Stem 104 of the worked example. */
    private function workedExample(): void
    {
        $this->item('104');
        $this->record('104', 'mid_diameter_max', 40);
        $this->record('104', 'mid_diameter_min', 39);
        $this->record('104', 'length', '4,10 m');
        foreach (['A' => '14,7 x 14,7 cm', 'B' => '14,7 x 14,7 cm', 'C' => '10,5 x 14,7 cm', 'D' => '10,5 x 14,7 cm'] as $letter => $section) {
            $this->item("104-$letter", '104');
            $this->record("104-$letter", 'sawn_cross_section', $section);
        }
    }

    /** @return array<string, mixed> */
    private function figures(string $tag, string $as = 'Ada', ?string $id = null, int $status = 200): array
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
        $this->client->request('GET', '/api/admin/timber-items/'.($id ?? $this->items[$tag]->toRfc4122()).'/key-figures');
        self::assertSame($status, $this->client->getResponse()->getStatusCode());

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    /**
     * @param array<string, mixed> $response
     *
     * @return array<string, array<string, mixed>> by key
     */
    private function byKey(array $response): array
    {
        return array_column($response['figures'], null, 'key');
    }

    public function testWorkedExampleMatchesTheFixtureAndTheExport(): void
    {
        $this->workedExample();

        $response = $this->figures('104');

        self::assertEqualsWithDelta(json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/key-figures-response.json'), true, flags: \JSON_THROW_ON_ERROR), $response, 1e-9);
        $figures = $this->byKey($response);
        self::assertEqualsWithDelta(0.502, $figures['round_wood']['value'], 0.0005);
        self::assertEqualsWithDelta(0.304, $figures['sawn_timber']['value'], 0.0005);
        self::assertEqualsWithDelta(0.60, $figures['yield']['value'], 0.005);

        $sheet = self::getContainer()->get(TimberReport::class)->build(new \DateTimeImmutable())->stems;
        $export = array_combine($sheet->headers, $sheet->rows[0]);
        self::assertSame($figures['round_wood']['value'], $export['Rundholz (fm)']);
        self::assertSame($figures['sawn_timber']['value'], $export['Schnittholz (m³)']);
        self::assertSame($figures['yield']['value'], $export['Ausbeute']);
    }

    public function testOneDiameterIsCalculatedAndSaysSo(): void
    {
        $this->item('7');
        $this->record('7', 'mid_diameter_min', 40);
        $this->record('7', 'length', '4,10 m');

        $figures = $this->figures('7')['figures'];

        self::assertSame(['round_wood', 'diameter_class'], array_column($figures, 'key'));
        self::assertNotNull($figures[0]['value']);
        self::assertSame('aus einem Durchmesser (40 cm) und 4,10 m', $figures[0]['source']);
        self::assertSame('aus einem Durchmesser (40 cm)', $figures[1]['source']);
    }

    public function testABeamWithoutCrossSectionNamesTheBeam(): void
    {
        $this->workedExample();
        $this->item('105');
        $this->record('105', 'mid_diameter_max', 34);
        $this->record('105', 'mid_diameter_min', 31);
        $this->record('105', 'length', '4,10 m');
        $this->item('105-A', '105');
        $this->item('105-B', '105');
        $this->record('105-A', 'sawn_cross_section', '14,7 x 14,7 cm');

        $figures = $this->byKey($this->figures('105'));

        self::assertNotNull($figures['round_wood']['value']);
        self::assertSame([null, null, null, null], [$figures['sawn_timber']['value'], $figures['sawn_timber']['inserted'], $figures['yield']['value'], $figures['yield']['inserted']]);
        self::assertSame('Querschnitt fehlt an Balken B', $figures['sawn_timber']['source']);
        self::assertSame('Schnittholz fehlt', $figures['yield']['source']);
    }

    public function testUnsawnStemHasRoundWoodOnlyAndABeamSawnTimberOnly(): void
    {
        $this->workedExample();
        $this->item('8');

        $unsawn = $this->figures('8')['figures'];
        self::assertSame(['round_wood', 'diameter_class'], array_column($unsawn, 'key'), 'every stem has the class, a beam does not');
        self::assertSame([null, 'Durchmesser fehlt', null], [$unsawn[1]['value'], $unsawn[1]['source'], $unsawn[1]['inserted']]);
        $beam = $this->figures('104-C')['figures'];
        self::assertSame(['sawn_timber'], array_column($beam, 'key'));
        self::assertSame('aus 10,5 × 14,7 cm und 4,10 m', $beam[0]['source'], 'the length is inherited from the stem');
        self::assertEqualsWithDelta(0.105 * 0.147 * 4.1, $beam[0]['value'], 1e-9);
    }

    public function testNotFoundForUnknownVoidedAndMalformedIds(): void
    {
        $this->workedExample();
        $this->item('9');
        $this->event('9', EventType::Voided, []);

        $this->figures('9', status: 404);
        $this->figures('', id: Uuid::v7()->toRfc4122(), status: 404);
        $this->figures('', id: 'abc', status: 404);
    }

    public function testNeedsTheAdministrationRole(): void
    {
        $this->workedExample();

        $this->figures('104', as: '', status: 401);
        $this->figures('104', as: 'Kerstin', status: 403);
    }
}
