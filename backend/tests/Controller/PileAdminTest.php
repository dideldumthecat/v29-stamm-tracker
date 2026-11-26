<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\Pile;
use App\Entity\User;
use App\Entity\UserRole;
use App\Tests\Support\Groups;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;

/** GET/POST/PATCH /api/admin/piles. */
class PileAdminTest extends WebTestCase
{
    private const string FIRST = '00000000-0000-7000-8000-0000000000a1';
    private const string SECOND = '00000000-0000-7000-8000-0000000000a2';
    private const string THIRD = '00000000-0000-7000-8000-0000000000a3';
    private const string LEGACY = '00000000-0000-7000-8000-0000000000a4';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private Attribute $source;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist(new User('Chef', UserRole::Admin, Groups::v29($this->em), User::hashToken(User::normalizeToken('Chef-test-token'))));
        $this->em->persist(new User('Bruno', UserRole::User, Groups::v29($this->em), User::hashToken(User::normalizeToken('Bruno-test-token'))));
        $this->em->persist($this->source = new Attribute('Polternummer', AttributeType::Choice, key: 'source'));
        // An attribute with options of another kind must stay out of the list.
        $other = new Attribute('Holzart', AttributeType::Choice);
        $this->em->persist($other);
        $this->em->persist(new AttributeOption($other, 'Eiche', 10));

        $options = [];
        foreach ([[self::FIRST, '2601-000001 (Beispielwald Nord)'], [self::SECOND, '2601-000002'], [self::THIRD, '2601-000003 (Lagerplatz am Weg)'], [self::LEGACY, '01']] as $i => [$id, $label]) {
            $this->em->persist($options[$id] = new AttributeOption($this->source, $label, 10 * ($i + 1), self::THIRD !== $id, Uuid::fromString($id)));
        }
        $this->em->persist(new Pile($options[self::FIRST], '2601-000001', 'Beispielwald Nord', '51.413056', '13.060556', '51.52'));
        $this->em->persist(new Pile($options[self::SECOND], '2601-000002'));
        $this->em->persist(new Pile($options[self::THIRD], '2601-000003', 'Lagerplatz am Weg', '51.400000', '13.050000', '8.00'));
        $this->em->flush();
    }

    /**
     * @param array<string, mixed>|null $body
     *
     * @return array<string, mixed>
     */
    private function call(string $method, string $uri = '', ?array $body = null, string $as = 'Chef'): array
    {
        $this->client->getCookieJar()->clear();
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
        $this->client->jsonRequest($method, '/api/admin/piles'.$uri, $body ?? []);

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    private function code(): int
    {
        return $this->client->getResponse()->getStatusCode();
    }

    /** @return list<string> "field: message" of a 422 */
    private function errors(): array
    {
        self::assertSame(422, $this->code());
        $body = json_decode($this->client->getResponse()->getContent(), true);

        return array_map(static fn (array $e) => $e['field'].': '.$e['message'], $body['errors']);
    }

    /** @return array<string, string> the labels by option id, read afresh */
    private function labels(): array
    {
        $this->em->clear();

        return array_column($this->call('GET')['piles'], 'label', 'id');
    }

    public function testOnlyAdminsMayUseIt(): void
    {
        foreach ([['GET', ''], ['POST', ''], ['PATCH', '/'.self::FIRST]] as [$method, $uri]) {
            $this->call($method, $uri, ['number' => 'X'], 'Bruno');
            self::assertSame(403, $this->code(), $method);
        }
    }

    public function testListMatchesTheFixture(): void
    {
        $fixture = json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/admin-piles-response.json'), true, flags: \JSON_THROW_ON_ERROR);

        self::assertSame($fixture, $this->call('GET'));
    }

    public function testCreatesTheOptionAtTheEndAndDerivesTheLabel(): void
    {
        $created = $this->call('POST', '', ['number' => ' 2601-000009 ', 'location' => 'Krummes F', 'latitude' => 51.5, 'longitude' => 13.1, 'stacked_volume' => 12.34]);

        self::assertSame(201, $this->code());
        self::assertSame(['2601-000009 (Krummes F)', '2601-000009', 12.34], [$created['label'], $created['number'], $created['stacked_volume']]);
        $labels = $this->labels();
        self::assertSame($created['id'], array_key_last($labels));
        self::assertCount(5, $labels);
    }

    public function testCreatesWithOnlyANumber(): void
    {
        $created = $this->call('POST', '', ['number' => '02']);

        self::assertSame(201, $this->code());
        self::assertSame(['02', '02', null, null], [$created['label'], $created['number'], $created['location'], $created['latitude']]);
    }

    public function testFirstPatchOfAnOptionWithoutARowCreatesTheRowAndOverwritesTheLabel(): void
    {
        $saved = $this->call('PATCH', '/'.self::LEGACY, ['number' => '2601-010145', 'location' => 'Krummes F', 'latitude' => 51.413056, 'longitude' => 13.060556, 'stacked_volume' => 51.52]);

        self::assertSame(200, $this->code());
        self::assertSame(['id' => self::LEGACY, 'label' => '2601-010145 (Krummes F)', 'number' => '2601-010145', 'location' => 'Krummes F',
            'latitude' => 51.413056, 'longitude' => 13.060556, 'stacked_volume' => 51.52], $saved);
        self::assertSame('2601-010145 (Krummes F)', $this->labels()[self::LEGACY]);
    }

    public function testTheFirstPatchOfAnOptionWithoutARowNeedsTheNumber(): void
    {
        $this->call('PATCH', '/'.self::LEGACY, ['location' => 'Krummes F']);
        self::assertSame(['number: Bitte eine Nummer eingeben.'], $this->errors());

        $this->em->clear();
        self::assertNull($this->em->find(Pile::class, Uuid::fromString(self::LEGACY)));
        self::assertSame('01', $this->labels()[self::LEGACY]);
    }

    public function testPatchKeepsWhatIsLeftOutAndEmptyTextBecomesNull(): void
    {
        $saved = $this->call('PATCH', '/'.self::FIRST, ['location' => '  ', 'stacked_volume' => null]);

        self::assertSame(['2601-000001', null, 51.413056, null], [$saved['number'], $saved['location'], $saved['latitude'], $saved['stacked_volume']]);
        self::assertSame('2601-000001', $saved['label']);
    }

    public function testPatchOfAnUnknownOrForeignIdIs404(): void
    {
        $this->call('PATCH', '/'.Uuid::v7()->toRfc4122(), ['number' => 'X']);
        self::assertSame(404, $this->code());
        $this->call('PATCH', '/nope', ['number' => 'X']);
        self::assertSame(404, $this->code());
    }

    /**
     * @param array<string, mixed> $input
     * @param list<string>         $expected
     */
    #[DataProvider('invalidInput')]
    public function testRules(array $input, array $expected): void
    {
        $this->call('POST', '', $input);

        self::assertSame($expected, $this->errors());
    }

    /** @return iterable<string, array{array<string, mixed>, list<string>}> */
    public static function invalidInput(): iterable
    {
        yield 'nothing' => [[], ['number: Bitte eine Nummer eingeben.']];
        yield 'blank number' => [['number' => ' ', 'location' => 'Am Bach'], ['number: Bitte eine Nummer eingeben.']];
        yield 'a location alone' => [['location' => 'Am Bach'], ['number: Bitte eine Nummer eingeben.']];
        yield 'texts too long' => [['number' => str_repeat('1', 33), 'location' => str_repeat('a', 201)], [
            'number: Die Nummer darf höchstens 32 Zeichen lang sein.', 'location: Der Lagerort darf höchstens 200 Zeichen lang sein.',
        ]];
        yield 'number is not a text' => [['number' => 12], ['number: Die Nummer muss ein Text sein.']];
        yield 'duplicate number' => [['number' => '2601-000001'], ['number: Einen Polter mit dieser Nummer gibt es schon.']];
        yield 'number equal to a label of an option without data' => [['number' => '01'], ['number: Einen Polter mit dieser Bezeichnung gibt es schon.']];
        yield 'only a latitude' => [['number' => 'N1', 'latitude' => 51.0], ['longitude: Bitte Breite und Länge zusammen angeben.']];
        yield 'only a longitude' => [['number' => 'N1', 'longitude' => 13.0], ['latitude: Bitte Breite und Länge zusammen angeben.']];
        yield 'coordinates out of range' => [['number' => 'N1', 'latitude' => 90.5, 'longitude' => -181], [
            'latitude: Die Breite muss eine Zahl zwischen -90 und 90 sein.', 'longitude: Die Länge muss eine Zahl zwischen -180 und 180 sein.',
        ]];
        yield 'coordinate as text' => [['number' => 'N1', 'latitude' => '51,4', 'longitude' => 13.0], ['latitude: Die Breite muss eine Zahl zwischen -90 und 90 sein.', 'latitude: Bitte Breite und Länge zusammen angeben.']];
        yield 'volume zero' => [['number' => 'N1', 'stacked_volume' => 0], ['stacked_volume: Die Raummeter müssen eine Zahl über 0 mit höchstens zwei Nachkommastellen sein.']];
        yield 'volume with three decimals' => [['number' => 'N1', 'stacked_volume' => 1.234], ['stacked_volume: Die Raummeter müssen eine Zahl über 0 mit höchstens zwei Nachkommastellen sein.']];
        yield 'volume too large' => [['number' => 'N1', 'stacked_volume' => 1000000], ['stacked_volume: Die Raummeter müssen eine Zahl über 0 mit höchstens zwei Nachkommastellen sein.']];
        yield 'volume as text' => [['number' => 'N1', 'stacked_volume' => '5'], ['stacked_volume: Die Raummeter müssen eine Zahl über 0 mit höchstens zwei Nachkommastellen sein.']];
        yield 'everything at once' => [['number' => '2601-000001', 'latitude' => 1, 'stacked_volume' => -1], [
            'number: Einen Polter mit dieser Nummer gibt es schon.', 'longitude: Bitte Breite und Länge zusammen angeben.',
            'stacked_volume: Die Raummeter müssen eine Zahl über 0 mit höchstens zwei Nachkommastellen sein.',
        ]];
    }

    public function testAPileKeepsItsOwnNumberAndLabelOnSave(): void
    {
        $saved = $this->call('PATCH', '/'.self::FIRST, ['number' => '2601-000001', 'location' => 'Beispielwald Nord', 'stacked_volume' => 60]);

        self::assertSame(200, $this->code());
        self::assertSame('2601-000001 (Beispielwald Nord)', $saved['label']);
    }

    public function testSavingLeavesTheActivityOfTheOptionAlone(): void
    {
        $this->call('PATCH', '/'.self::THIRD, ['stacked_volume' => 9]);
        self::assertSame(200, $this->code());
        $this->call('PATCH', '/'.self::FIRST, ['active' => false]);
        self::assertSame(200, $this->code());
        $this->em->clear();

        $active = [];
        foreach ($this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $this->source]) as $option) {
            $active[$option->id->toRfc4122()] = $option->active;
        }
        self::assertSame([self::FIRST => true, self::SECOND => true, self::THIRD => false, self::LEGACY => true], $active);
        self::assertArrayNotHasKey('active', $this->call('GET')['piles'][0]);
    }

    public function testWithoutTheAttributeTheListIsEmptyAndACreationIs404(): void
    {
        $this->em->remove($this->em->find(Attribute::class, $this->source->id));
        foreach ($this->em->getRepository(Pile::class)->findAll() as $pile) {
            $this->em->remove($pile);
        }
        foreach ($this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $this->source]) as $option) {
            $this->em->remove($option);
        }
        $this->em->flush();

        self::assertSame(['piles' => []], $this->call('GET'));
        $this->call('POST', '', ['number' => 'X']);
        self::assertSame(404, $this->code());
    }
}
