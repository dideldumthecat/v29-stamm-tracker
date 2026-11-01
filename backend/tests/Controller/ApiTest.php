<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\User;
use App\Entity\UserRole;
use App\Photo\PhotoStorage;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpFoundation\Cookie as ResponseCookie;
use Symfony\Component\HttpFoundation\File\UploadedFile;
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
    private const LIEFERDATUM = 'a6f6626b-71d8-4316-98f0-89c71a8e39a0';
    private const FAELLDATUM = 'a222dbf7-15cd-44cd-92c9-18969c610238';
    private const LAGERPLATZ = '1903019a-8027-4e12-8bc1-e1db3e08f803';
    private const TRAUBENEICHE = 'af0c94b3-caef-4a22-ac9d-32b76876a0d1';
    private const FOTOS = 'c8bcdbf8-6f14-46e2-b82d-b6962ba1ae10';
    private const STIELEICHE = '8b2b5909-3247-4abe-8604-08909006f9e9';

    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);

        $snapshot = self::fixture('snapshot');
        foreach ($snapshot['users'] as $user) {
            $this->em->persist(new User($user['name'], UserRole::User, User::hashToken(User::normalizeToken($user['name'].'-test-token')), id: Uuid::fromString($user['id'])));
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

    protected function tearDown(): void
    {
        array_map('unlink', glob('/tmp/v29-photos-test/*/*.jpg') ?: []);
        parent::tearDown();
    }

    private static function jpeg(int $bytes = 1000): string
    {
        return "\xFF\xD8\xFF\xE0".random_bytes($bytes - 4);
    }

    private function upload(string $content, ?string $id = null, ?string $itemId = null, ?string $as = 'Alexander'): array
    {
        $file = tempnam(sys_get_temp_dir(), 'photo');
        file_put_contents($file, $content);
        $this->client->getCookieJar()->clear();
        if ($as) {
            $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
        }
        $this->client->request('POST', '/api/photos', [
            'id' => $id ?? self::fixture('photo-upload-response')['id'],
            'timber_item_id' => $itemId ?? self::ITEM_123,
            'taken_at' => '2026-10-02T07:12:00.000Z',
        ], ['file' => new UploadedFile($file, 'photo.jpg', 'image/jpeg', null, true)]);

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    private function photoCount(): int
    {
        return $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM photos');
    }

    private function download(string $id, ?string $as = 'Alexander'): string
    {
        $this->client->getCookieJar()->clear();
        if ($as) {
            $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
        }
        $this->client->request('GET', '/api/photos/'.$id);

        return $this->client->getInternalResponse()->getContent();
    }

    private static function fixture(string $name): array
    {
        return json_decode(file_get_contents(self::FIXTURES.$name.'.json'), true, flags: \JSON_THROW_ON_ERROR);
    }

    private function request(string $method, string $uri, ?array $body = null, ?string $as = 'Alexander'): array
    {
        $this->client->getCookieJar()->clear();
        if ($as) {
            $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
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
        $response = $this->request('POST', '/api/session', ['token' => 'Alexander-test-token'], as: null);

        self::assertResponseIsSuccessful();
        self::assertSame(self::fixture('session-response'), $response);
        $cookie = array_find($this->client->getResponse()->headers->getCookies(), static fn ($c) => SessionController::COOKIE === $c->getName());
        self::assertSame(User::normalizeToken('Alexander-test-token'), $cookie->getValue());
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

        foreach (['nope', 'Kerstin-test-token'] as $token) {
            $this->request('POST', '/api/session', ['token' => $token], as: null);
            self::assertResponseStatusCodeSame(401, $token);
        }
    }

    public function testSessionAcceptsACodeInAnySpellingAndStoresItNormalized(): void
    {
        $user = new User('Jana', UserRole::User, User::hashToken('K7QM4XHT9RD1'));
        $this->em->persist($user);
        $this->em->flush();

        foreach (['K7QM-4XHT-9RD1', 'k7qm4xht9rdl', ' k7qm 4xht 9rdi '] as $code) {
            $response = $this->request('POST', '/api/session', ['token' => $code], as: null);
            self::assertResponseIsSuccessful($code);
            self::assertSame('Jana', $response['user']['name']);
            $cookie = array_find($this->client->getResponse()->headers->getCookies(), static fn ($c) => SessionController::COOKIE === $c->getName());
            self::assertSame('K7QM4XHT9RD1', $cookie->getValue());
        }
    }

    public function testCookieWithACodeIsCheckedNormalized(): void
    {
        $this->em->find(User::class, Uuid::fromString(self::KERSTIN))->tokenHash = User::hashToken('K7QM4XHT9RD1');
        $this->em->flush();

        foreach (['K7QM4XHT9RD1', 'k7qm-4xht-9rdl'] as $code) {
            $this->client->getCookieJar()->clear();
            $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $code));
            $this->client->jsonRequest('GET', '/api/snapshot');
            self::assertResponseIsSuccessful($code);
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
            'malformed date' => self::event('attribute_recorded', $item, ['attribute_id' => self::LIEFERDATUM, 'value' => '2026-02-30']),
            'malformed month' => self::event('attribute_recorded', $item, ['attribute_id' => self::FAELLDATUM, 'value' => '2026-13']),
            'date for a month' => self::event('attribute_recorded', $item, ['attribute_id' => self::FAELLDATUM, 'value' => '2026-10-01']),
            'unknown attribute' => self::event('attribute_recorded', $item, ['attribute_id' => Uuid::v4()->toRfc4122(), 'value' => true]),
            'voided with data' => self::event('voided', $item, ['reason' => 'x']),
            'voided stem' => self::event('voided', self::ITEM_123, []),
            'voided unknown item' => self::event('voided', Uuid::v4()->toRfc4122(), []),
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

    private function rejectedSyncs(): array
    {
        return array_map(static fn (array $row) => ['user_id' => Uuid::fromBinary($row['user_id'])->toRfc4122(), 'reason' => $row['reason'], 'events' => json_decode($row['events'], true)],
            $this->em->getConnection()->fetchAllAssociative('SELECT user_id, reason, events FROM rejected_syncs'));
    }

    public function testADuplicateStemIsRejectedWithItsValuesAndBeamsWhileTheRestIsAccepted(): void
    {
        $this->syncItem123();
        [$duplicate, $beam, $fresh] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $rejected = [
            self::event('created', $duplicate, ['parent_id' => null]),
            self::event('tag_assigned', $duplicate, ['tag_number' => '123']),
            self::event('attribute_recorded', $duplicate, ['attribute_id' => self::HOLZART, 'value' => self::STIELEICHE]),
            self::event('created', $beam, ['parent_id' => $duplicate]),
            self::event('tag_assigned', $beam, ['tag_number' => '123-A']),
        ];
        $accepted = [
            self::event('created', $fresh, ['parent_id' => null]),
            self::event('tag_assigned', $fresh, ['tag_number' => '124']),
            self::event('attribute_recorded', self::ITEM_123, ['attribute_id' => self::HOLZART, 'value' => self::TRAUBENEICHE]),
        ];

        $response = $this->request('POST', '/api/sync', ['events' => [$rejected[0], $accepted[0], ...array_slice($rejected, 1), ...array_slice($accepted, 1)]], 'Alexander');
        self::assertResponseIsSuccessful();
        self::assertSame(array_column($accepted, 'id'), $response['accepted_event_ids']);
        self::assertSame(array_map(static fn (array $e) => ['event_id' => $e['id'], 'timber_item_id' => $e['timber_item_id'], 'tag_number' => '123', 'reason' => 'tag_already_taken'], $rejected), $response['rejected']);

        $items = array_column($this->request('GET', '/api/snapshot')['timber_items'], 'tag_number', 'id');
        self::assertEquals([self::ITEM_123 => '123', $fresh => '124'], array_intersect_key($items, [self::ITEM_123 => 1, $fresh => 1]));
        self::assertArrayNotHasKey($duplicate, $items);
        self::assertArrayNotHasKey($beam, $items);
        self::assertSame(self::TRAUBENEICHE, $this->values(self::ITEM_123)[self::HOLZART][0]['value']);
        self::assertSame([['user_id' => self::ALEXANDER, 'reason' => 'tag_already_taken', 'events' => $rejected]], $this->rejectedSyncs());
    }

    public function testTheSecondOfTwoStemsWithTheSameTagInOneRequestIsRejected(): void
    {
        [$first, $second] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $events = [
            self::event('created', $first, ['parent_id' => null]),
            self::event('tag_assigned', $first, ['tag_number' => '7']),
            self::event('created', $second, ['parent_id' => null]),
            self::event('tag_assigned', $second, ['tag_number' => '7']),
        ];

        $response = $this->request('POST', '/api/sync', ['events' => $events]);
        self::assertResponseIsSuccessful();
        self::assertSame(array_column(array_slice($events, 0, 2), 'id'), $response['accepted_event_ids']);
        self::assertSame([$second, $second], array_column($response['rejected'], 'timber_item_id'));
        self::assertSame([$first], array_column($this->request('GET', '/api/snapshot')['timber_items'], 'id'));

        // Resending the accepted stem is no conflict with itself.
        self::assertSame([], $this->request('POST', '/api/sync', ['events' => array_slice($events, 0, 2)])['rejected']);
    }

    public function testABeamWithATagAnotherBeamAlreadyHoldsIsRejected(): void
    {
        $this->syncItem123();
        [$beam, $duplicate] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $beam, ['parent_id' => self::ITEM_123]),
            self::event('tag_assigned', $beam, ['tag_number' => '123-A']),
        ]], 'Kerstin');

        $response = $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $duplicate, ['parent_id' => self::ITEM_123]),
            self::event('tag_assigned', $duplicate, ['tag_number' => '123-A']),
            self::event('attribute_recorded', $duplicate, ['attribute_id' => self::LIEFERDATUM, 'value' => '2026-02-02']),
        ]]);
        self::assertResponseIsSuccessful();
        self::assertSame([], $response['accepted_event_ids']);
        self::assertSame(['123-A', '123-A', '123-A'], array_column($response['rejected'], 'tag_number'));
        self::assertNotContains($duplicate, array_column($this->request('GET', '/api/snapshot')['timber_items'], 'id'));
        self::assertCount(1, $this->rejectedSyncs());
    }

    public function testATagChangeToAFreeTagMakesTheItemFindableOnlyByTheNewTagAndKeepsTheHistory(): void
    {
        $this->syncItem123();
        $retag = self::event('tag_assigned', self::ITEM_123, ['tag_number' => '132']);

        $response = $this->request('POST', '/api/sync', ['events' => [$retag]]);
        self::assertSame([$retag['id']], $response['accepted_event_ids']);
        self::assertSame([], $response['rejected']);

        $tags = array_column($this->request('GET', '/api/snapshot')['timber_items'], 'tag_number', 'id');
        self::assertSame([self::ITEM_123 => '132'], $tags);
        self::assertSame(['123', '132'], $this->em->getConnection()->fetchFirstColumn(
            "SELECT JSON_VALUE(data, '$.tag_number') FROM timber_item_events WHERE type = 'tag_assigned' ORDER BY received_at"));
    }

    public function testATagChangeToATagOnTheServerIsRejectedAloneWhileTheRestIsAccepted(): void
    {
        $this->syncItem123();
        $other = Uuid::v4()->toRfc4122();
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $other, ['parent_id' => null]),
            self::event('tag_assigned', $other, ['tag_number' => '456']),
        ]], 'Kerstin');

        $retag = self::event('tag_assigned', self::ITEM_123, ['tag_number' => '456']);
        $value = self::event('attribute_recorded', self::ITEM_123, ['attribute_id' => self::HOLZART, 'value' => self::TRAUBENEICHE]);
        $response = $this->request('POST', '/api/sync', ['events' => [$retag, $value]]);
        self::assertResponseIsSuccessful();
        self::assertSame([$value['id']], $response['accepted_event_ids']);
        self::assertSame([['event_id' => $retag['id'], 'timber_item_id' => self::ITEM_123, 'tag_number' => '456', 'reason' => 'tag_already_taken']], $response['rejected']);
        self::assertSame([['user_id' => self::ALEXANDER, 'reason' => 'tag_already_taken', 'events' => [$retag]]], $this->rejectedSyncs());

        $tags = array_column($this->request('GET', '/api/snapshot')['timber_items'], 'tag_number', 'id');
        self::assertSame('123', $tags[self::ITEM_123]);
        self::assertSame(self::TRAUBENEICHE, $this->values(self::ITEM_123)[self::HOLZART][0]['value']);

        // Resending the accepted event is still no conflict.
        self::assertSame([], $this->request('POST', '/api/sync', ['events' => [$value]])['rejected']);
    }

    public function testATagChangeToATagTakenEarlierInTheSameRequestIsRejected(): void
    {
        $this->syncItem123();
        $fresh = Uuid::v4()->toRfc4122();
        $events = [
            self::event('created', $fresh, ['parent_id' => null]),
            self::event('tag_assigned', $fresh, ['tag_number' => '7']),
            self::event('tag_assigned', self::ITEM_123, ['tag_number' => '7']),
            // Retagging the new item in the same request is checked as well.
            self::event('tag_assigned', $fresh, ['tag_number' => '123']),
        ];

        $response = $this->request('POST', '/api/sync', ['events' => $events]);
        self::assertResponseIsSuccessful();
        self::assertSame(array_column(array_slice($events, 0, 2), 'id'), $response['accepted_event_ids']);
        self::assertSame([[$events[2]['id'], '7'], [$events[3]['id'], '123']],
            array_map(null, array_column($response['rejected'], 'event_id'), array_column($response['rejected'], 'tag_number')));

        $tags = array_column($this->request('GET', '/api/snapshot')['timber_items'], 'tag_number', 'id');
        self::assertEquals([self::ITEM_123 => '123', $fresh => '7'], array_intersect_key($tags, [self::ITEM_123 => 1, $fresh => 1]));
    }

    public function testMonthValueIsAccepted(): void
    {
        $item = Uuid::v4()->toRfc4122();
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $item, ['parent_id' => null]),
            self::event('attribute_recorded', $item, ['attribute_id' => self::FAELLDATUM, 'value' => '2026-10']),
        ]]);
        self::assertResponseIsSuccessful();
        self::assertSame('2026-10', $this->values($item)[self::FAELLDATUM][0]['value']);
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
        $ownDeliveryDate = self::event('attribute_recorded', $beam, ['attribute_id' => self::LIEFERDATUM, 'value' => '2026-02-02']);
        $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $log, ['parent_id' => null]),
            $species,
            self::event('attribute_recorded', $log, ['attribute_id' => self::LIEFERDATUM, 'value' => '2026-01-01']),
            self::event('attribute_recorded', $log, ['attribute_id' => self::LAGERPLATZ, 'value' => '85c9b9d6-6714-4416-a91e-21efd4e4adfd']),
            self::event('created', $beam, ['parent_id' => $log]),
            $ownDeliveryDate,
            self::event('created', $beamOfBeam, ['parent_id' => $beam]),
        ]], 'Kerstin');
        self::assertResponseIsSuccessful();

        $inheritedSpecies = [['value' => self::TRAUBENEICHE, 'recorded_at' => '2026-10-01T08:00:00.000Z', 'user_id' => self::KERSTIN, 'event_id' => $species['id']]];
        foreach ([$beam, $beamOfBeam] as $item) {
            $values = $this->values($item);
            self::assertEqualsCanonicalizing([self::HOLZART, self::LIEFERDATUM], array_keys($values));
            self::assertSame($inheritedSpecies, $values[self::HOLZART]);
            self::assertSame($ownDeliveryDate['id'], $values[self::LIEFERDATUM][0]['event_id']);
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

    /** Beams 123-A and 123-B of item 123, both synced. */
    private function syncBeams(): array
    {
        $this->syncItem123();
        [$a, $b] = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $this->request('POST', '/api/sync', ['events' => [
            // Distinct creation times: the snapshot lists items by creation time, and equal times leave the order to the random ids.
            self::event('created', $a, ['parent_id' => self::ITEM_123], '2026-10-02T07:13:00.000Z'),
            self::event('tag_assigned', $a, ['tag_number' => '123-A'], '2026-10-02T07:13:01.000Z'),
            self::event('created', $b, ['parent_id' => self::ITEM_123], '2026-10-02T07:14:00.000Z'),
            self::event('tag_assigned', $b, ['tag_number' => '123-B'], '2026-10-02T07:14:01.000Z'),
            self::event('attribute_recorded', $b, ['attribute_id' => self::LIEFERDATUM, 'value' => '2026-02-02'], '2026-10-02T07:14:02.000Z'),
        ]]);

        return [$a, $b];
    }

    private function void(string $tag, array $options = [], bool $withAdmin = true): CommandTester
    {
        if ($withAdmin && !$this->em->getRepository(User::class)->findBy(['role' => UserRole::Admin])) {
            $this->em->persist(new User('Admin', UserRole::Admin, User::hashToken('admin-test-token')));
            $this->em->flush();
        }
        $tester = new CommandTester((new Application($this->client->getKernel()))->find('app:item:void'));
        $tester->execute(['tag' => $tag, ...$options], ['interactive' => false]);

        return $tester;
    }

    private function snapshotItems(): array
    {
        return array_column($this->request('GET', '/api/snapshot')['timber_items'], null, 'id');
    }

    public function testAVoidedBeamLeavesTheSnapshot(): void
    {
        [$a, $b] = $this->syncBeams();

        $tester = $this->void('0123-b');
        self::assertSame(0, $tester->getStatusCode());
        self::assertStringContainsString('Beam', $tester->getDisplay());
        self::assertMatchesRegularExpression('/Recorded values\s+1/', $tester->getDisplay());

        $items = $this->snapshotItems();
        self::assertSame([self::ITEM_123, $a], array_keys($items));
        self::assertTrue($items[self::ITEM_123]['has_children']);
        self::assertSame('voided', $this->em->getConnection()->fetchOne('SELECT type FROM timber_item_events WHERE reference_id IS NOT NULL'));
    }

    public function testTheAppCanVoidABeamAndTheServerReferencesItsCreatedEvent(): void
    {
        [$a, $b] = $this->syncBeams();
        $created = $this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ?', [Uuid::fromString($b)->toBinary(), 'created']);
        $void = self::event('voided', $b, []);

        // Sent twice, and a second void of the same beam from another event: accepted without harm.
        foreach ([[$void], [$void, self::event('voided', $b, [])]] as $events) {
            $response = $this->request('POST', '/api/sync', ['events' => $events]);
            self::assertResponseIsSuccessful();
            self::assertSame(array_column($events, 'id'), $response['accepted_event_ids']);
        }

        self::assertSame([self::ITEM_123, $a], array_keys($this->snapshotItems()));
        self::assertSame(3 + 5 + 2, $this->eventCount());
        self::assertSame($created, $this->em->getConnection()->fetchOne('SELECT reference_id FROM timber_item_events WHERE id = ?', [Uuid::fromString($void['id'])->toBinary()]));
        self::assertTrue($this->snapshotItems()[self::ITEM_123]['has_children']);

        $this->request('POST', '/api/sync', ['events' => [self::event('voided', $a, [])]]);
        self::assertFalse($this->snapshotItems()[self::ITEM_123]['has_children']);
    }

    public function testTheAppCannotVoidAStem(): void
    {
        $this->syncItem123();
        $before = $this->eventCount();

        $this->request('POST', '/api/sync', ['events' => [self::event('voided', self::ITEM_123, [])]]);

        self::assertResponseStatusCodeSame(400);
        self::assertSame($before, $this->eventCount());
        self::assertArrayHasKey(self::ITEM_123, $this->snapshotItems());
    }

    public function testAVoidedBeamFreesItsLetterAlsoWithinTheSameRequest(): void
    {
        [, $b] = $this->syncBeams();
        $again = Uuid::v4()->toRfc4122();

        $response = $this->request('POST', '/api/sync', ['events' => [
            self::event('voided', $b, []),
            self::event('created', $again, ['parent_id' => self::ITEM_123]),
            self::event('tag_assigned', $again, ['tag_number' => '123-B']),
        ]]);

        self::assertSame([], $response['rejected']);
        self::assertSame('123-B', $this->snapshotItems()[$again]['tag_number']);
    }

    public function testTheTagOfAVoidedItemCanBeTakenAgain(): void
    {
        $this->syncItem123();
        self::assertSame(0, $this->void('123')->getStatusCode());

        $fresh = Uuid::v4()->toRfc4122();
        $response = $this->request('POST', '/api/sync', ['events' => [
            self::event('created', $fresh, ['parent_id' => null]),
            self::event('tag_assigned', $fresh, ['tag_number' => '123']),
        ]]);
        self::assertSame([], $response['rejected']);
        self::assertSame([$fresh => '123'], array_column($this->snapshotItems(), 'tag_number', 'id'));
    }

    public function testAStemWithBeamsIsRefusedAndTheBeamsAreNamed(): void
    {
        [, $b] = $this->syncBeams();
        $this->void('123-A');

        $tester = $this->void('123');
        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString('123-B', $tester->getDisplay());
        self::assertStringNotContainsString('123-A', preg_replace('/^.*Not voided/s', '', $tester->getDisplay()));
        self::assertArrayHasKey(self::ITEM_123, $this->snapshotItems());
        self::assertArrayHasKey($b, $this->snapshotItems());
    }

    public function testAStemWithoutBeamsIsVoidedAndOneWhoseBeamsAreVoidedIsEditableAgain(): void
    {
        $this->syncBeams();
        $this->void('123-A');
        $this->void('123-B');
        self::assertFalse($this->snapshotItems()[self::ITEM_123]['has_children']);

        self::assertSame(0, $this->void('123')->getStatusCode());
        self::assertSame([], $this->snapshotItems());
        self::assertSame(1, $this->void('123')->getStatusCode());
    }

    public function testLateEventsOnAVoidedItemAreAcceptedAndChangeNothing(): void
    {
        [, $b] = $this->syncBeams();
        $this->void('123-B');
        $before = $this->request('GET', '/api/snapshot');

        $late = [
            self::event('attribute_recorded', $b, ['attribute_id' => self::LIEFERDATUM, 'value' => '2026-03-03']),
            self::event('tag_assigned', $b, ['tag_number' => '1999']),
            // A beam another device added offline to a stem voided meanwhile.
            self::event('created', $beamOfVoided = Uuid::v4()->toRfc4122(), ['parent_id' => $b]),
        ];
        $response = $this->request('POST', '/api/sync', ['events' => $late]);
        self::assertSame(array_column($late, 'id'), $response['accepted_event_ids']);

        $after = $this->request('GET', '/api/snapshot');
        unset($before['generated_at'], $after['generated_at']);
        self::assertSame($before, $after);
        self::assertArrayNotHasKey($beamOfVoided, $this->snapshotItems());
    }

    public function testRebuildGivesTheSameSnapshotAfterVoids(): void
    {
        $this->syncBeams();
        $this->void('123-B');
        $this->request('POST', '/api/sync', ['events' => [self::event('created', $stem = Uuid::v4()->toRfc4122(), ['parent_id' => null]), self::event('tag_assigned', $stem, ['tag_number' => '5'])]]);
        $this->void('5');
        $live = $this->request('GET', '/api/snapshot');

        $tester = new CommandTester((new Application($this->client->getKernel()))->find('app:projections:rebuild'));
        self::assertSame(0, $tester->execute([]));
        $rebuilt = $this->request('GET', '/api/snapshot');

        unset($live['generated_at'], $rebuilt['generated_at']);
        self::assertSame($live, $rebuilt);
    }

    public function testVoidNeedsExactlyOneAdmin(): void
    {
        $this->syncItem123();
        $tester = $this->void('123', withAdmin: false);
        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString('--user', $tester->getDisplay());

        self::assertSame(1, $this->void('12x')->getStatusCode());
        self::assertArrayHasKey(self::ITEM_123, $this->snapshotItems());
    }

    public function testPhotoUploadStoresTheFileUnchangedAndAnswersLikeTheFixture(): void
    {
        $jpeg = self::jpeg();
        $response = $this->upload($jpeg);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(self::fixture('photo-upload-response'), $response);
        $row = $this->em->getConnection()->fetchAssociative('SELECT size, sha256, taken_at, user_id FROM photos');
        self::assertSame(1000, $row['size']);
        self::assertSame(hash('sha256', $jpeg), $row['sha256']);
        self::assertSame('2026-10-02 07:12:00.000000', $row['taken_at']);
        self::assertSame(Uuid::fromString(self::ALEXANDER)->toBinary(), $row['user_id']);
        self::assertSame($jpeg, file_get_contents(self::getContainer()->get(PhotoStorage::class)->path(Uuid::fromString($response['id']))));
    }

    public function testPhotoUploadRejectsTooLargeFilesAndNonJpegs(): void
    {
        $this->upload(self::jpeg(PhotoStorage::MAX_BYTES + 1));
        self::assertResponseStatusCodeSame(413);

        $this->upload('GIF89a not a jpeg');
        self::assertResponseStatusCodeSame(415);

        $this->upload(self::jpeg(), id: 'not-a-uuid');
        self::assertResponseStatusCodeSame(400);
        self::assertSame(0, $this->photoCount());
    }

    public function testPhotoUploadMayBeRepeatedWithoutDuplicates(): void
    {
        $jpeg = self::jpeg();
        $this->upload($jpeg);
        $this->upload(self::jpeg());

        self::assertResponseStatusCodeSame(200);
        self::assertSame(1, $this->photoCount());
        self::assertSame($jpeg, $this->download(self::fixture('photo-upload-response')['id']));
    }

    public function testPhotosNeedAValidCookie(): void
    {
        $id = self::fixture('photo-upload-response')['id'];
        $this->upload(self::jpeg(), as: null);
        self::assertResponseStatusCodeSame(401);
        self::assertSame(0, $this->photoCount());

        $this->upload(self::jpeg());
        $this->download($id, as: null);
        self::assertResponseStatusCodeSame(401);
        $this->download($id, as: 'Unknown');
        self::assertResponseStatusCodeSame(401);
    }

    public function testPhotoDownloadServesTheJpegOrAnswers404(): void
    {
        $jpeg = self::jpeg();
        $this->upload($jpeg);

        self::assertSame($jpeg, $this->download(self::fixture('photo-upload-response')['id']));
        self::assertResponseIsSuccessful();
        self::assertSame('image/jpeg', $this->client->getResponse()->headers->get('Content-Type'));
        self::assertSame('nosniff', $this->client->getResponse()->headers->get('X-Content-Type-Options'));

        $this->download(Uuid::v4()->toRfc4122());
        self::assertResponseStatusCodeSame(404);
    }

    public function testSyncAcceptsAPhotoEventBeforeItsFileArrives(): void
    {
        $this->syncItem123();
        $photoId = self::fixture('photo-upload-response')['id'];
        $response = $this->request('POST', '/api/sync', ['events' => [self::event('attribute_recorded', self::ITEM_123, ['attribute_id' => self::FOTOS, 'value' => $photoId])]]);

        self::assertResponseIsSuccessful();
        self::assertCount(1, $response['accepted_event_ids']);
        self::assertSame($photoId, $this->values(self::ITEM_123)[self::FOTOS][0]['value']);
        $this->download($photoId);
        self::assertResponseStatusCodeSame(404);

        $this->upload(self::jpeg());
        $this->download($photoId);
        self::assertResponseIsSuccessful();
    }

    public function testEveryPhotoOfAnItemCounts(): void
    {
        $this->syncItem123();
        $ids = [Uuid::v4()->toRfc4122(), Uuid::v4()->toRfc4122()];
        $this->request('POST', '/api/sync', ['events' => array_map(static fn (string $id) => self::event('attribute_recorded', self::ITEM_123, ['attribute_id' => self::FOTOS, 'value' => $id]), $ids)]);

        self::assertSame($ids, array_column($this->values(self::ITEM_123)[self::FOTOS], 'value'));
    }
}
