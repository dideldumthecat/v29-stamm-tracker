<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpFoundation\Cookie as ResponseCookie;
use Symfony\Component\Uid\Uuid;

/**
 * The fixtures in frontend/src/api/fixtures are the expectation. Users and attributes come from snapshot.json.
 */
class ApiTest extends WebTestCase
{
    private const FIXTURES = __DIR__.'/../../../frontend/src/api/fixtures/';
    private const KERSTIN = '993955be-5888-4f39-937c-56af8c5187c1';
    private const ALEXANDER = '1634106f-49e1-459f-9b11-bf0cd848292d';
    private const ITEM_123 = '9e12e819-ef6e-45c7-8801-494177724c56';
    private const HOLZART = '0847b35f-f94e-4f68-84c6-63426a5dcf77';
    private const HOLZFEUCHTE = 'd609577e-6b6c-42ce-8ad2-17729b975338';
    private const FAELLDATUM = 'a6f6626b-71d8-4316-98f0-89c71a8e39a0';
    private const LAGERPLATZ = '1903019a-8027-4e12-8bc1-e1db3e08f803';
    private const TRAUBENEICHE = 'af0c94b3-caef-4a22-ac9d-32b76876a0d1';
    private const STIELEICHE = '8b2b5909-3247-4abe-8604-08909006f9e9';

    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);

        $snapshot = self::fixture('snapshot');
        foreach ($snapshot['users'] as $user) {
            $this->em->persist(new User($user['name'], UserRole::User, User::hashToken($user['name'].'-token'), id: Uuid::fromString($user['id'])));
        }
        foreach ($snapshot['attributes'] as $a) {
            $attribute = new Attribute($a['name'], AttributeType::from($a['type']), $a['description'], $a['unit'], $a['is_series'],
                $a['is_inheritable'], $a['sort_order'], $a['active'], Uuid::fromString($a['id']));
            $this->em->persist($attribute);
            foreach ($a['options'] as $o) {
                $this->em->persist(new AttributeOption($attribute, $o['label'], $o['sort_order'], $o['active'], Uuid::fromString($o['id'])));
            }
        }
        $this->em->flush();
    }

    private static function fixture(string $name): array
    {
        return json_decode(file_get_contents(self::FIXTURES.$name.'.json'), true, flags: \JSON_THROW_ON_ERROR);
    }

    private function request(string $method, string $uri, ?array $body = null, ?string $as = 'Alexander'): array
    {
        $this->client->getCookieJar()->clear();
        if ($as) {
            $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-token'));
        }
        $this->client->jsonRequest($method, $uri, $body ?? []);

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    private static function event(string $type, string $itemId, array $data, string $recordedAt = '2026-10-02T07:12:00.000Z'): array
    {
        return ['id' => Uuid::v4()->toRfc4122(), 'schema_version' => 1, 'type' => $type, 'timber_item_id' => $itemId, 'data' => $data, 'recorded_at' => $recordedAt];
    }

    /** Item 123 from snapshot.json with one moisture reading, synced by Kerstin; sync-request.json adds a second. */
    private function syncItem123(): void
    {
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', self::ITEM_123, ['parent_id' => null]),
            self::event('tag_assigned', self::ITEM_123, ['tag_number' => '123']),
            self::event('attribute_recorded', self::ITEM_123, ['attribute_id' => self::HOLZFEUCHTE, 'value' => 48.5]),
        ]], 'Kerstin');
        self::assertResponseIsSuccessful();
    }

    private function eventCount(): int
    {
        return $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events');
    }

    private function values(string $itemId): array
    {
        $items = array_column($this->request('GET', '/api/snapshot')['timber_items'], null, 'id');

        return $items[$itemId]['values'];
    }

    public function testSessionWithValidTokenAnswersLikeTheFixtureAndSetsTheCookie(): void
    {
        $response = $this->request('POST', '/api/session', ['token' => 'Alexander-token'], as: null);

        self::assertResponseIsSuccessful();
        self::assertSame(self::fixture('session-response'), $response);
        $cookie = array_find($this->client->getResponse()->headers->getCookies(), static fn ($c) => SessionController::COOKIE === $c->getName());
        self::assertSame('Alexander-token', $cookie->getValue());
        self::assertSame('/api', $cookie->getPath());
        self::assertTrue($cookie->isHttpOnly());
        self::assertTrue($cookie->isSecure());
        self::assertSame(ResponseCookie::SAMESITE_STRICT, $cookie->getSameSite());
        self::assertGreaterThan(strtotime('+4 years'), $cookie->getExpiresTime());
    }

    public function testSessionRejectsUnknownAndRevokedTokens(): void
    {
        $this->em->find(User::class, Uuid::fromString(self::KERSTIN))->revokedAt = new \DateTimeImmutable();
        $this->em->flush();

        foreach (['nope', 'Kerstin-token'] as $token) {
            $this->request('POST', '/api/session', ['token' => $token], as: null);
            self::assertResponseStatusCodeSame(401, $token);
        }
    }

    public function testSnapshotAndSyncNeedAValidCookie(): void
    {
        foreach ([null, 'Unknown'] as $as) {
            $this->request('GET', '/api/snapshot', as: $as);
            self::assertResponseStatusCodeSame(401);
            $this->request('POST', '/api/sync', self::fixture('sync-request'), as: $as);
            self::assertResponseStatusCodeSame(401);
        }
        self::assertSame(0, $this->eventCount());
    }

    public function testSyncAnswersLikeTheFixtureAndIgnoresResentEvents(): void
    {
        $this->syncItem123();

        foreach ([1, 2] as $attempt) {
            self::assertSame(self::fixture('sync-response'), $this->request('POST', '/api/sync', self::fixture('sync-request')), "attempt $attempt");
            self::assertSame(3 + 4, $this->eventCount(), "attempt $attempt");
        }
        $users = $this->em->getConnection()->fetchFirstColumn('SELECT DISTINCT user_id FROM timber_item_events WHERE id = ?', [Uuid::fromString('c3cef810-83cb-4035-89de-e492f2edfb37')->toBinary()]);
        self::assertSame([Uuid::fromString(self::ALEXANDER)->toBinary()], $users);
    }

    public function testInvalidRequestsAreRejectedWithoutStoringAnything(): void
    {
        $item = Uuid::v4()->toRfc4122();
        $created = self::event('created', $item, ['parent_id' => null]);
        $lagerplatzOption = '85c9b9d6-6714-4416-a91e-21efd4e4adfd';
        $invalid = [
            'option of another attribute' => self::event('attribute_recorded', $item, ['attribute_id' => self::HOLZART, 'value' => $lagerplatzOption]),
            'text for a number' => self::event('attribute_recorded', $item, ['attribute_id' => self::HOLZFEUCHTE, 'value' => '41']),
            'malformed date' => self::event('attribute_recorded', $item, ['attribute_id' => 'a6f6626b-71d8-4316-98f0-89c71a8e39a0', 'value' => '2026-02-30']),
            'unknown attribute' => self::event('attribute_recorded', $item, ['attribute_id' => Uuid::v4()->toRfc4122(), 'value' => true]),
            'voided from the app' => self::event('voided', $item, []),
            'missing recorded_at' => array_diff_key(self::event('tag_assigned', $item, ['tag_number' => '7']), ['recorded_at' => true]),
            'unknown item' => self::event('tag_assigned', Uuid::v4()->toRfc4122(), ['tag_number' => '7']),
            'unknown parent' => self::event('created', Uuid::v4()->toRfc4122(), ['parent_id' => Uuid::v4()->toRfc4122()]),
        ];

        foreach ($invalid as $case => $event) {
            $this->request('POST', '/api/sync', ['events' => [$created, $event]]);
            self::assertResponseStatusCodeSame(400, $case);
            self::assertSame(0, $this->eventCount(), $case);
        }
        self::assertSame([], $this->request('GET', '/api/snapshot')['timber_items']);
    }

    public function testTheLaterOfTwoValuesInOneRequestWinsRegardlessOfDeviceTime(): void
    {
        $item = Uuid::v4()->toRfc4122();
        $second = self::event('attribute_recorded', $item, ['attribute_id' => self::HOLZART, 'value' => '8b2b5909-3247-4abe-8604-08909006f9e9'], '2026-10-01T00:00:00.000Z');
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $item, ['parent_id' => null]),
            self::event('attribute_recorded', $item, ['attribute_id' => self::HOLZART, 'value' => 'af0c94b3-caef-4a22-ac9d-32b76876a0d1']),
            $second,
        ]]);
        self::assertResponseIsSuccessful();

        $records = $this->values($item)[self::HOLZART];
        self::assertCount(1, $records);
        self::assertSame($second['id'], $records[0]['event_id']);
    }

    public function testSnapshotMatchesTheFixtureAfterSync(): void
    {
        $this->syncItem123();
        $this->request('POST', '/api/sync', self::fixture('sync-request'));

        $expected = self::fixture('snapshot');
        $snapshot = $this->request('GET', '/api/snapshot');
        self::assertResponseIsSuccessful();
        self::assertSame(array_keys($expected), array_keys($snapshot));
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', $snapshot['generated_at']);
        self::assertEqualsCanonicalizing($expected['users'], $snapshot['users']);
        self::assertSame($expected['attributes'], $snapshot['attributes']);

        $items = array_column($snapshot['timber_items'], null, 'id');
        self::assertSame(array_keys($expected['timber_items'][0]), array_keys($items[self::ITEM_123]));
        self::assertSame(['id' => self::ITEM_123, 'parent_id' => null, 'tag_number' => '123', 'has_children' => false,
            'created_at' => '2026-10-02T07:12:00.000Z', 'created_by' => self::KERSTIN],
            array_diff_key($items[self::ITEM_123], ['values' => true]));
        // Series: both readings, oldest first, in contract form.
        $readings = $items[self::ITEM_123]['values'][self::HOLZFEUCHTE];
        self::assertSame(array_keys($expected['timber_items'][0]['values'][self::HOLZFEUCHTE][0]), array_keys($readings[0]));
        self::assertSame([48.5, 37.2], array_column($readings, 'value'));
        self::assertSame(['recorded_at' => '2026-10-22T09:45:02.000Z', 'user_id' => self::ALEXANDER, 'event_id' => 'b73f1927-2ca2-4846-a6bc-cdb30223f437'],
            array_intersect_key($readings[1], ['user_id' => 1, 'event_id' => 1, 'recorded_at' => 1]));

        self::assertSame('1042', $items['a561559a-c281-4b25-8a1a-0a8ab97931f9']['tag_number']);
        self::assertSame('af0c94b3-caef-4a22-ac9d-32b76876a0d1', $items['a561559a-c281-4b25-8a1a-0a8ab97931f9']['values'][self::HOLZART][0]['value']);
        // An item without values is an empty object, not an empty list.
        $this->request('POST', '/api/sync', ['events' => [self::event('created', $empty = Uuid::v4()->toRfc4122(), ['parent_id' => null])]]);
        $this->client->request('GET', '/api/snapshot');
        self::assertStringContainsString('"id":"'.$empty.'","parent_id":null,"tag_number":null,"has_children":false', $this->client->getResponse()->getContent());
        self::assertStringContainsString('"values":{}', $this->client->getResponse()->getContent());
    }

    public function testBeamInheritsInheritableValuesThroughAllLevelsAndItsOwnValueWins(): void
    {
        [$log, $beam, $beamOfBeam] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $species = self::event('attribute_recorded', $log, ['attribute_id' => self::HOLZART, 'value' => self::TRAUBENEICHE], '2026-10-01T08:00:00.000Z');
        $ownFellingDate = self::event('attribute_recorded', $beam, ['attribute_id' => self::FAELLDATUM, 'value' => '2026-02-02']);
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $log, ['parent_id' => null]),
            $species,
            self::event('attribute_recorded', $log, ['attribute_id' => self::FAELLDATUM, 'value' => '2026-01-01']),
            self::event('attribute_recorded', $log, ['attribute_id' => self::LAGERPLATZ, 'value' => '85c9b9d6-6714-4416-a91e-21efd4e4adfd']),
            self::event('created', $beam, ['parent_id' => $log]),
            $ownFellingDate,
            self::event('created', $beamOfBeam, ['parent_id' => $beam]),
        ]], 'Kerstin');
        self::assertResponseIsSuccessful();

        $inheritedSpecies = [['value' => self::TRAUBENEICHE, 'recorded_at' => '2026-10-01T08:00:00.000Z', 'user_id' => self::KERSTIN, 'event_id' => $species['id']]];
        foreach ([$beam, $beamOfBeam] as $item) {
            $values = $this->values($item);
            self::assertEqualsCanonicalizing([self::HOLZART, self::FAELLDATUM], array_keys($values));
            self::assertSame($inheritedSpecies, $values[self::HOLZART]);
            self::assertSame($ownFellingDate['id'], $values[self::FAELLDATUM][0]['event_id']);
        }
    }

    public function testBeamShowsTheParentsSeriesUntilItHasOwnRecordingsThenOnlyItsOwn(): void
    {
        $series = new Attribute('Rissbreite', AttributeType::Number, isSeries: true, isInheritable: true);
        $this->em->persist($series);
        $this->em->flush();
        $attributeId = $series->id->toRfc4122();
        [$log, $beam] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $reading = static fn (string $item, float $value) => self::event('attribute_recorded', $item, ['attribute_id' => $attributeId, 'value' => $value]);

        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $log, ['parent_id' => null]),
            $reading($log, 1.5),
            $reading($log, 2.5),
            self::event('created', $beam, ['parent_id' => $log]),
        ]]);
        self::assertResponseIsSuccessful();
        self::assertSame($this->values($log)[$attributeId], $this->values($beam)[$attributeId]);

        $this->request('POST', '/api/sync', ['events' => [$reading($beam, 4.5), $reading($log, 3.5)]]);
        self::assertResponseIsSuccessful();
        self::assertSame([4.5], array_column($this->values($beam)[$attributeId], 'value'));
    }

    public function testInheritedValuesDoNotDependOnTheOrderInWhichParentAndBeamEventsArrive(): void
    {
        $beamValues = function (bool $parentValuesFirst): array {
            [$log, $beam] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
            $parentValues = [
                self::event('attribute_recorded', $log, ['attribute_id' => self::HOLZART, 'value' => self::TRAUBENEICHE]),
                self::event('attribute_recorded', $log, ['attribute_id' => self::HOLZART, 'value' => self::STIELEICHE]),
            ];
            $beamEvents = [self::event('created', $beam, ['parent_id' => $log])];
            $this->request('POST', '/api/sync', ['events' => [self::event('created', $log, ['parent_id' => null])]]);
            foreach ($parentValuesFirst ? [$parentValues, $beamEvents] : [$beamEvents, $parentValues] as $events) {
                $this->request('POST', '/api/sync', ['events' => $events]);
                self::assertResponseIsSuccessful();
            }

            return array_map(static fn (array $records) => array_map(static fn (array $r) => array_diff_key($r, ['event_id' => true]), $records), $this->values($beam));
        };

        $values = $beamValues(true);
        self::assertSame(self::STIELEICHE, $values[self::HOLZART][0]['value']);
        self::assertSame($values, $beamValues(false));
    }

    /** Another device recorded offline before the split and syncs after it: the app's read-only rule must not block that queue. */
    public function testSplitItemStillAcceptsLateValuesAndPassesInheritableOnesOn(): void
    {
        [$log, $beam] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $this->request('POST', '/api/sync', ['events' => [self::event('created', $log, ['parent_id' => null]), self::event('created', $beam, ['parent_id' => $log])]]);

        $species = self::event('attribute_recorded', $log, ['attribute_id' => self::HOLZART, 'value' => self::STIELEICHE]);
        $storagePlace = self::event('attribute_recorded', $log, ['attribute_id' => self::LAGERPLATZ, 'value' => '85c9b9d6-6714-4416-a91e-21efd4e4adfd']);
        $this->request('POST', '/api/sync', ['events' => [$species, $storagePlace]], 'Kerstin');
        self::assertResponseIsSuccessful();

        self::assertEqualsCanonicalizing([self::HOLZART, self::LAGERPLATZ], array_keys($this->values($log)));
        self::assertSame([self::HOLZART], array_keys($this->values($beam)));
        self::assertSame($species['id'], $this->values($beam)[self::HOLZART][0]['event_id']);
    }

    public function testRebuildGivesTheSameSnapshotAsTheLiveProjections(): void
    {
        $this->syncItem123();
        $this->request('POST', '/api/sync', self::fixture('sync-request'));
        [$beam, $beamOfBeam] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $beam, ['parent_id' => self::ITEM_123]),
            self::event('tag_assigned', $beam, ['tag_number' => '123-A']),
            self::event('created', $beamOfBeam, ['parent_id' => $beam]),
            self::event('attribute_recorded', self::ITEM_123, ['attribute_id' => self::HOLZART, 'value' => self::STIELEICHE]),
        ]]);
        $live = $this->request('GET', '/api/snapshot');
        self::assertTrue(array_column($live['timber_items'], 'has_children', 'id')[self::ITEM_123]);
        self::assertSame(self::STIELEICHE, $this->values($beamOfBeam)[self::HOLZART][0]['value']);

        $tester = new CommandTester((new Application($this->client->getKernel()))->find('app:projections:rebuild'));
        self::assertSame(0, $tester->execute([]));
        $rebuilt = $this->request('GET', '/api/snapshot');

        unset($live['generated_at'], $rebuilt['generated_at']);
        self::assertSame($live, $rebuilt);
    }
}
