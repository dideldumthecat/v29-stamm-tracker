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
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;

/**
 * GET /api/admin/activity. Events are written directly with chosen times: two real syncs in a test would fall into the same second.
 */
class ActivityTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private TimberItemProjector $projector;
    private User $ada;
    private User $barina;
    private Attribute $sawn;
    private Attribute $notes;
    private Attribute $length;
    private Attribute $photos;
    private Attribute $diameter;
    private Attribute $count;
    private Attribute $felled;
    private AttributeOption $fourTen;
    /** @var array<string, Uuid> item ids by tag */
    private array $items = [];
    private int $sequence = 0;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->projector = self::getContainer()->get(TimberItemProjector::class);

        foreach ([[$this->ada = new User('Ada', UserRole::Superadmin, User::hashToken(User::normalizeToken('Ada-test-token')))],
            [$this->barina = new User('Barina', UserRole::User, User::hashToken(User::normalizeToken('Barina-test-token')))],
            [new User('Chef', UserRole::Admin, User::hashToken(User::normalizeToken('Chef-test-token')))]] as [$user]) {
            $this->em->persist($user);
        }
        $this->em->persist($this->sawn = new Attribute('Gesägt', AttributeType::Boolean));
        $this->em->persist($this->notes = new Attribute('Notiz', AttributeType::Text, isSeries: true));
        $this->em->persist($this->length = new Attribute('Länge', AttributeType::Choice));
        $this->em->persist($this->photos = new Attribute('Fotos', AttributeType::Photo, isSeries: true));
        $this->em->persist($this->diameter = new Attribute('Stammmittendurchmesser groß', AttributeType::Number, unit: 'cm'));
        $this->em->persist($this->count = new Attribute('Anzahl', AttributeType::Number));
        $this->em->persist($this->felled = new Attribute('Fälldatum', AttributeType::Month));
        $this->em->persist($this->fourTen = new AttributeOption($this->length, '4,10 m'));
        $this->em->flush();
    }

    /** @return array<string, mixed> */
    private function activity(string $query = '', string $as = 'Chef'): array
    {
        $this->client->getCookieJar()->clear();
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
        $this->client->request('GET', '/api/admin/activity'.$query);

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    /** Ids count up (and so keep their order); the fixture activity-response.json holds them. */
    private function nextId(): Uuid
    {
        return Uuid::fromString(\sprintf('00000000-0000-7000-8000-%012d', ++$this->sequence));
    }

    /** @param array<string, mixed> $data */
    private function add(User $user, EventType $type, string $tag, array $data, string $received, ?string $recorded = null, ?Uuid $reference = null): Uuid
    {
        $item = $this->items[$tag] ??= $this->nextId();
        $event = new TimberItemEvent($this->nextId(), $item, $type, $data, new \DateTimeImmutable($recorded ?? $received, new \DateTimeZone('UTC')),
            $user, $reference, new \DateTimeImmutable($received, new \DateTimeZone('UTC')));
        $this->em->persist($event);
        $this->em->flush();

        return $event->id;
    }

    private function stem(User $user, string $tag, string $received, ?string $recorded = null): void
    {
        $this->add($user, EventType::Created, $tag, ['parent_id' => null], $received, $recorded);
        $this->add($user, EventType::TagAssigned, $tag, ['tag_number' => $tag], self::later($received), $recorded);
    }

    /** One microsecond later: events of one item keep their order without relying on the id. */
    private static function later(string $time): string
    {
        return (new \DateTimeImmutable($time, new \DateTimeZone('UTC')))->modify('+1 microsecond')->format('Y-m-d H:i:s.u');
    }

    private function beam(User $user, string $stem, string $tag, string $received, string $recorded): void
    {
        $this->items[$tag] = $this->nextId();
        $this->add($user, EventType::Created, $tag, ['parent_id' => $this->items[$stem]->toRfc4122()], $received, $recorded);
        $this->add($user, EventType::TagAssigned, $tag, ['tag_number' => $tag], self::later($received), $recorded);
    }

    private function sawn(User $user, string $tag, string $received, ?string $recorded = null): Uuid
    {
        return $this->add($user, EventType::AttributeRecorded, $tag, ['attribute_id' => $this->sawn->id->toRfc4122(), 'value' => true], $received, $recorded);
    }

    private function note(User $user, string $tag, string $text, string $received, ?string $recorded = null): Uuid
    {
        return $this->add($user, EventType::AttributeRecorded, $tag, ['attribute_id' => $this->notes->id->toRfc4122(), 'value' => $text], $received, $recorded);
    }

    private function photo(User $user, string $tag, string $received, ?string $recorded = null): Uuid
    {
        return $this->add($user, EventType::AttributeRecorded, $tag, ['attribute_id' => $this->photos->id->toRfc4122(), 'value' => Uuid::v4()->toRfc4122()], $received, $recorded);
    }

    private function project(): void
    {
        foreach ($this->items as $id) {
            $this->projector->project($id);
        }
    }

    /**
     * "Name: value" of each change, per item label of the entry.
     *
     * @param array<string, mixed> $entry
     *
     * @return array<list<string>> by item label (numeric labels become integer keys)
     */
    private static function lines(array $entry): array
    {
        return array_combine(array_column($entry['items'], 'label'), array_map(static fn (array $item) => array_map(static fn (array $change) => $change['name'].': '.$change['value'], $item['changes']), $entry['items']));
    }

    public function testOnlyAdministratorsMayRead(): void
    {
        $this->activity(as: 'Barina');
        self::assertResponseStatusCodeSame(403);
        $this->activity(as: 'Nobody');
        self::assertResponseStatusCodeSame(401);
        $this->activity(as: 'Ada');
        self::assertResponseStatusCodeSame(200);
    }

    public function testASyncIsOneEntryAndTwoSyncsOfThePersonAreTwo(): void
    {
        $this->stem($this->barina, '104', '2026-10-31 10:46:01.000100', '2026-10-31 10:40:00');
        $this->sawn($this->barina, '104', '2026-10-31 10:46:01.000300', '2026-10-31 10:41:00');
        $this->note($this->barina, '104', '105x145', '2026-10-31 10:48:30.000100', '2026-10-31 10:47:00');
        $this->project();

        $response = $this->activity();

        self::assertCount(2, $response['entries']);
        [$second, $first] = $response['entries'];
        self::assertSame(['entries' => 2, 'events' => 4, 'photos' => 0, 'users' => 1], $response['totals']);
        self::assertSame(3, $first['event_count']);
        self::assertSame(1, $second['event_count']);
        self::assertSame('2026-10-31T10:46:01.000Z', $first['received_at']);
        self::assertSame('2026-10-31T10:40:00.000Z', $first['recorded_from']);
        self::assertSame('2026-10-31T10:41:00.000Z', $first['recorded_to']);
        self::assertSame(['id' => $this->barina->id->toRfc4122(), 'name' => 'Barina'], $first['user']);
        self::assertSame(['104' => ['Stamm: angelegt', 'Kennung: 104', 'Gesägt: ja']], self::lines($first));
        self::assertSame(['104' => ['Notiz: 105x145']], self::lines($second));
    }

    public function testEventsOfTwoPeopleAtTheSameTimeAreSeparateEntries(): void
    {
        $this->sawn($this->barina, '1', '2026-10-31 10:00:00.000100', '2026-10-31 09:00:00');
        $this->sawn($this->ada, '2', '2026-10-31 10:00:00.000200', '2026-10-31 09:00:00');
        $this->sawn($this->barina, '3', '2026-10-31 10:00:00.000300', '2026-10-31 09:00:00');
        $this->project();

        // Newest first: Ada's single event began after Barina's first
        self::assertSame([1, 2], array_column($this->activity()['entries'], 'event_count'));
    }

    public function testAConsoleCommandIsAnEntryWithItsInstantAsRecordedTime(): void
    {
        $this->stem($this->ada, '1999', '2026-10-30 10:00:00.000100', '2026-10-30 09:00:00');
        $this->project();
        $created = $this->createdEvent('1999');
        $this->add($this->ada, EventType::Voided, '1999', [], '2026-10-31 16:09:00.000000', reference: $created);

        $entry = $this->activity('?from=2026-10-31')['entries'][0];

        self::assertSame(['1999' => ['Stamm: storniert']], self::lines($entry));
        self::assertSame(['2026-10-31T16:09:00.000Z', '2026-10-31T16:09:00.000Z'], [$entry['recorded_from'], $entry['recorded_to']]);
    }

    public function testItemsComeStemFirstWithTextsFromTheData(): void
    {
        $this->stem($this->barina, '104', '2026-10-31 10:00:00.000100');
        $this->project();
        $this->sawn($this->barina, '104', '2026-10-31 10:46:01.000100', '2026-10-31 10:40:00');
        $this->beam($this->barina, '104', '104-A', '2026-10-31 10:46:01.000200', '2026-10-31 10:40:01');
        $this->photo($this->barina, '104-A', '2026-10-31 10:46:01.000400', '2026-10-31 10:41:00');
        $this->beam($this->barina, '104', '104-B', '2026-10-31 10:46:01.000500', '2026-10-31 10:40:02');
        $this->add($this->barina, EventType::AttributeRecorded, '104-B', ['attribute_id' => $this->length->id->toRfc4122(), 'value' => $this->fourTen->id->toRfc4122()], '2026-10-31 10:46:01.000700', '2026-10-31 10:42:00');
        $this->sawn($this->barina, '104', '2026-10-31 10:46:01.000800', '2026-10-31 10:43:00');
        $this->project();

        $entry = $this->activity('?from=2026-10-31&to=2026-10-31')['entries'][0];

        self::assertSame([
            '104' => ['Gesägt: ja', 'Gesägt: ja'],
            '104-A' => ['Balken: angelegt', 'Kennung: 104-A', 'Fotos: hinzugefügt'],
            '104-B' => ['Balken: angelegt', 'Kennung: 104-B', 'Länge: 4,10 m'],
        ], self::lines($entry));
        self::assertSame(['created', 'tag', 'photo'], array_column($entry['items'][1]['changes'], 'kind'));
        self::assertSame('2026-10-31T10:41:00.000Z', $entry['items'][1]['changes'][2]['recorded_at']);
        self::assertSame($this->items['104-A']->toRfc4122(), $entry['items'][1]['timber_item_id']);
        self::assertSame(8, $entry['event_count']);
    }

    public function testValuesAreWrittenGermanWithUnitMonthInWordsAndYesNo(): void
    {
        $this->stem($this->barina, '7', '2026-10-31 10:00:00.000100', '2026-10-31 09:00:00');
        $this->project();
        $record = fn (Attribute $attribute, bool|int|float|string $value, int $at) => $this->add($this->barina, EventType::AttributeRecorded, '7',
            ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $value], \sprintf('2026-10-31 10:00:01.%06d', $at), '2026-10-31 09:00:00');
        $record($this->diameter, 22.5, 1);
        $record($this->diameter, 22, 2);
        $record($this->count, 3.25, 3);
        $record($this->count, 4, 4);
        $record($this->felled, '2026-10-15', 5);
        $record($this->sawn, false, 6);
        $record($this->sawn, true, 7);

        self::assertSame([
            'Stamm: angelegt', 'Kennung: 7', 'Stammmittendurchmesser groß: 22,5 cm', 'Stammmittendurchmesser groß: 22 cm', 'Anzahl: 3,25', 'Anzahl: 4',
            'Fälldatum: Oktober 2026', 'Gesägt: nein', 'Gesägt: ja',
        ], self::lines($this->activity('?from=2026-10-31')['entries'][0])['7']);
    }

    public function testVoidedAndRestoredNameTheAffectedEvent(): void
    {
        $this->stem($this->ada, '55', '2026-10-30 10:00:00.000100');
        $note = $this->note($this->ada, '55', 'krumm', '2026-10-30 10:00:00.000200');
        $voided = $this->add($this->ada, EventType::Voided, '55', [], '2026-10-31 10:00:00', reference: $note);
        $this->add($this->ada, EventType::Restored, '55', [], '2026-10-31 11:00:00', reference: $voided);
        $this->project();

        $entries = $this->activity()['entries'];

        self::assertSame(['Notiz: wiederhergestellt'], self::lines($entries[0])['55']);
        self::assertSame(['Notiz: storniert'], self::lines($entries[1])['55']);
        self::assertSame(['restored'], array_column($entries[0]['items'][0]['changes'], 'kind'));
    }

    public function testAMovedPhotoIsRemovedAtTheSourceAndAddedAtTheTarget(): void
    {
        $this->stem($this->ada, '55', '2026-10-30 10:00:00.000100');
        $this->stem($this->ada, '56', '2026-10-30 10:00:00.000200');
        $photo = $this->photo($this->ada, '55', '2026-10-30 10:00:00.000300');
        $this->add($this->ada, EventType::Voided, '55', [], '2026-10-31 10:00:00.000100', reference: $photo);
        $this->photo($this->ada, '56', '2026-10-31 10:00:00.000200');
        $this->project();

        $entry = $this->activity()['entries'][0];

        self::assertSame([['photo_removed', 'Fotos', 'entfernt'], ['photo', 'Fotos', 'hinzugefügt']], array_map(
            static fn (array $item) => [$item['changes'][0]['kind'], $item['changes'][0]['name'], $item['changes'][0]['value']],
            $entry['items'],
        ));
    }

    public function testEveryChangeHasNameAndValueForTheTable(): void
    {
        $this->stem($this->ada, '10', '2026-10-30 10:00:00.000100');
        $this->beam($this->ada, '10', '10-A', '2026-10-30 10:00:00.000300', '2026-10-30 10:00:00');
        $sawn = $this->sawn($this->ada, '10', '2026-10-30 10:00:00.000500');
        $photo = $this->photo($this->ada, '10', '2026-10-30 10:00:00.000600');
        $this->project();
        $tag = Uuid::fromBinary($this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ?', [$this->items['10-A']->toBinary(), 'tag_assigned']));
        $this->add($this->ada, EventType::Voided, '10-A', [], '2026-10-31 10:00:00.000100', reference: $this->createdEvent('10-A'));
        $this->add($this->ada, EventType::Voided, '10', [], '2026-10-31 10:00:00.000200', reference: $sawn);
        $this->add($this->ada, EventType::Voided, '10', [], '2026-10-31 10:00:00.000300', reference: $photo);
        $this->add($this->ada, EventType::Voided, '10-A', [], '2026-10-31 10:00:00.000400', reference: $tag);
        $stemVoid = $this->add($this->ada, EventType::Voided, '10', [], '2026-11-01 10:00:00.000100', reference: $this->createdEvent('10'));
        $this->add($this->ada, EventType::Restored, '10', [], '2026-11-01 10:00:00.000200', reference: $stemVoid);
        $this->add($this->ada, EventType::Voided, '10', [], '2026-11-02 10:00:00.000100', reference: Uuid::v4());
        $this->project();

        $rows = [];
        foreach (array_reverse($this->activity()['entries']) as $entry) {
            foreach ($entry['items'] as $item) {
                foreach ($item['changes'] as $change) {
                    $rows[] = [$item['label'], $change['name'], $change['value']];
                }
            }
        }

        self::assertSame([
            ['10', 'Stamm', 'angelegt'], ['10', 'Kennung', '10'], ['10', 'Gesägt', 'ja'], ['10', 'Fotos', 'hinzugefügt'],
            ['10-A', 'Balken', 'angelegt'], ['10-A', 'Kennung', '10-A'],
            ['10', 'Gesägt', 'storniert'], ['10', 'Fotos', 'entfernt'],
            ['10-A', 'Balken', 'storniert'], ['10-A', 'Kennung', 'storniert'],
            ['10', 'Stamm', 'storniert'], ['10', 'Stamm', 'wiederhergestellt'],
            ['10', 'Ereignis', 'storniert'],
        ], $rows);
    }

    public function testTagFilterFindsStemsAndTheirBeamsAndKeepsOnlyThemInTheEntry(): void
    {
        $this->stem($this->barina, '104', '2026-10-31 10:00:00.000100', '2026-10-31 09:00:00');
        $this->stem($this->barina, '105', '2026-10-31 10:00:00.000300', '2026-10-31 09:00:00');
        $this->beam($this->barina, '104', '104-A', '2026-10-31 10:00:00.000500', '2026-10-31 09:00:00');
        $this->photo($this->barina, '104-A', '2026-10-31 10:00:00.000700', '2026-10-31 09:00:00');
        $this->sawn($this->barina, '105', '2026-10-31 10:00:00.000800', '2026-10-31 09:00:00');
        $this->project();

        $entry = $this->activity('?tags=104')['entries'][0];
        self::assertSame(['104', '104-A'], array_column($entry['items'], 'label'));
        self::assertSame(5, $entry['event_count']);
        self::assertSame(['entries' => 1, 'events' => 5, 'photos' => 1, 'users' => 1], $this->activity('?tags=0104')['totals']);

        self::assertSame(['104', '104-A', '105'], array_column($this->activity('?tags=100-120')['entries'][0]['items'], 'label'));
        self::assertSame([], $this->activity('?tags=300')['entries']);
        self::assertSame(['entries' => 0, 'events' => 0, 'photos' => 0, 'users' => 0], $this->activity('?tags=300')['totals']);
    }

    public function testTagFilterAlsoFindsAVoidedStem(): void
    {
        $this->stem($this->ada, '1999', '2026-10-31 15:00:00.000100');
        $created = $this->add($this->ada, EventType::Created, '1999', ['parent_id' => null], '2026-10-31 15:00:00.000050');
        $this->add($this->ada, EventType::Voided, '1999', [], '2026-10-31 16:00:00', reference: $created);
        $this->project();

        self::assertCount(2, $this->activity('?tags=1999')['entries']);
    }

    public function testDaysAreGermanDaysAndBothLimitsAreInclusive(): void
    {
        // Berlin is UTC+1 on 31 October 2026: 22:59:59 UTC is still the 31st, 23:00:00 UTC is already 1 November.
        foreach (['1', '2', '3', '4'] as $tag) {
            $this->stem($this->ada, $tag, '2026-10-01 10:00:00');
        }
        // Alternating people, so that neighbours at the limit do not form one entry
        $this->sawn($this->ada, '1', '2026-10-30 22:59:59.999900', '2026-10-30 09:00:00');
        $this->sawn($this->barina, '2', '2026-10-30 23:00:00.000000', '2026-10-30 09:00:00');
        $this->sawn($this->ada, '3', '2026-10-31 22:59:59.999900', '2026-10-30 09:00:00');
        $this->sawn($this->barina, '4', '2026-10-31 23:00:00.000000', '2026-10-30 09:00:00');
        $this->project();

        $tags = fn (string $query) => array_map(static fn (array $entry) => $entry['items'][0]['label'] ?? null, $this->activity($query)['entries']);
        // Entries are newest first
        self::assertSame(['3', '2'], $tags('?from=2026-10-31&to=2026-10-31'));
        self::assertSame(['4'], $tags('?from=2026-11-01'));
        self::assertSame(['3', '2', '1'], $tags('?from=2026-10-30&to=2026-10-31'));
        self::assertSame(['4', '3', '2', '1'], $tags('?from=2026-10-30'));
    }

    public function testPagesFollowEachOtherWithoutDuplicatesOrGapsAndNeverSplitAnEntry(): void
    {
        for ($i = 0; $i < 70; ++$i) {
            $this->sawn($this->ada, (string) ($i + 1), \sprintf('2026-10-31 10:%02d:%02d.000100', intdiv($i, 60), $i % 60), '2026-10-30 09:00:00');
        }
        // One console command with 30 events, newest of all but one: it falls on the first page and is whole there.
        for ($i = 0; $i < 30; ++$i) {
            $this->sawn($this->ada, (string) (200 + $i), '2026-10-31 12:00:00.000000');
        }
        $this->project();

        $first = $this->activity();
        self::assertCount(50, $first['entries']);
        self::assertSame(30, $first['entries'][0]['event_count']);
        self::assertSame(['entries' => 71, 'events' => 100, 'photos' => 0, 'users' => 1], $first['totals']);
        self::assertNotNull($first['next_cursor']);

        $second = $this->activity('?before='.$first['next_cursor']);
        self::assertCount(21, $second['entries']);
        self::assertNull($second['next_cursor']);
        $ids = array_column([...$first['entries'], ...$second['entries']], 'id');
        self::assertCount(71, array_unique($ids));
        // Newest first across the pages
        self::assertGreaterThan($second['entries'][0]['received_at'], $first['entries'][49]['received_at']);

        $this->activity('?before=nonsense');
        self::assertResponseStatusCodeSame(400);
    }

    public function testFiltersByPersonAndListsEveryoneWithEvents(): void
    {
        $this->sawn($this->ada, '1', '2026-10-31 10:00:00.000100', '2026-10-31 09:00:00');
        $this->sawn($this->barina, '2', '2026-10-31 11:00:00.000100', '2026-10-31 09:00:00');
        $this->photo($this->barina, '2', '2026-10-31 11:00:00.000200', '2026-10-31 09:00:00');
        $this->project();

        $response = $this->activity('?user='.$this->barina->id->toRfc4122());

        self::assertSame(['entries' => 1, 'events' => 2, 'photos' => 1, 'users' => 1], $response['totals']);
        self::assertSame(['Ada', 'Barina'], array_column($response['users'], 'name'));
        self::assertSame($this->ada->id->toRfc4122(), $response['users'][0]['id']);
    }

    public function testEntriesUnfilteredCountsEveryEntryWhateverTheFilter(): void
    {
        $this->sawn($this->ada, '1', '2026-10-30 10:00:00.000100', '2026-10-30 09:00:00');
        $this->stem($this->ada, '2', '2026-10-31 10:00:00.000100', '2026-10-31 09:00:00');
        $this->sawn($this->barina, '3', '2026-10-31 11:00:00.000100', '2026-10-31 09:00:00');
        for ($i = 0; $i < 60; ++$i) {
            $this->sawn($this->ada, (string) (100 + $i), \sprintf('2026-11-01 10:%02d:00.000100', $i), '2026-11-01 09:00:00');
        }
        $this->project();

        $none = $this->activity();
        self::assertSame(63, $none['entries_unfiltered']);
        self::assertSame(63, $none['totals']['entries']);

        // "all" filters nothing
        self::assertSame(63, $this->activity('?tags=all')['entries_unfiltered']);

        $day = $this->activity('?from=2026-10-31&to=2026-10-31');
        self::assertSame(2, $day['totals']['entries']);
        self::assertSame(63, $day['entries_unfiltered']);

        $person = $this->activity('?user='.$this->barina->id->toRfc4122());
        self::assertSame(1, $person['totals']['entries']);
        self::assertSame(63, $person['entries_unfiltered']);

        $tag = $this->activity('?tags=2');
        self::assertSame(1, $tag['totals']['entries']);
        self::assertSame(63, $tag['entries_unfiltered']);

        // a tag filter without any match still tells the total
        $nothing = $this->activity('?tags=300');
        self::assertSame(0, $nothing['totals']['entries']);
        self::assertSame(63, $nothing['entries_unfiltered']);

        // the same on every page
        $first = $this->activity('?user='.$this->ada->id->toRfc4122());
        self::assertSame(62, $first['totals']['entries']);
        self::assertNotNull($first['next_cursor']);
        $second = $this->activity('?user='.$this->ada->id->toRfc4122().'&before='.$first['next_cursor']);
        self::assertSame(63, $first['entries_unfiltered']);
        self::assertSame(63, $second['entries_unfiltered']);
    }

    public function testMalformedFiltersAreRefused(): void
    {
        foreach (['?from=31.10.2026', '?to=2026-02-30', '?user=x', '?tags=abc', '?tags=0'] as $query) {
            $this->activity($query);
            self::assertResponseStatusCodeSame(400, $query);
        }
    }

    /**
     * The 31 October as it happened (shortened): a stem with beams, a sawmill with many stems, the console voiding 1998 and 1999.
     * The fixture is the expectation, the administration's tests use the same file.
     */
    public function testResponseMatchesTheFixture(): void
    {
        $users = [];
        foreach (['Alexander Summa' => UserRole::Superadmin, 'Alexander Barina' => UserRole::User, 'Sägewerk Eulitz GbR' => UserRole::User, 'Florian Summa' => UserRole::User] as $name => $role) {
            $this->em->persist($users[$name] = new User($name, $role, User::hashToken(User::normalizeToken($name.'-test-token')), id: $this->nextId()));
        }
        $this->em->flush();
        [$alexander, $barina, $sawmill, $florian] = array_values($users);

        // Earlier days: the stems exist already (not part of the response, which starts on 31 October).
        foreach (['104', '128', '55', '97', '1998', '1999', '48', '78', '86', '110', '111', '119', '126', '125'] as $tag) {
            $this->stem($florian, $tag, '2026-10-30 09:30:00.000100', '2026-10-30 08:00:00');
        }
        $this->project();
        $created1998 = $this->createdEvent('1998');
        $created1999 = $this->createdEvent('1999');

        $this->photo($florian, '55', '2026-10-31 10:40:00.000100', '2026-10-31 07:43:30');
        $this->photo($florian, '128', '2026-10-31 10:41:00.000100', '2026-10-31 10:40:50');
        $this->photo($florian, '128', '2026-10-31 10:41:00.000200', '2026-10-31 10:41:10');

        $this->sawn($barina, '104', '2026-10-31 10:48:30.000100', '2026-10-31 10:46:00');
        $this->beam($barina, '104', '104-A', '2026-10-31 10:48:30.000200', '2026-10-31 10:46:20');
        $this->photo($barina, '104-A', '2026-10-31 10:48:30.000400', '2026-10-31 10:46:40');
        $this->beam($barina, '104', '104-B', '2026-10-31 10:48:30.000500', '2026-10-31 10:47:00');
        $this->photo($barina, '104-B', '2026-10-31 10:48:30.000700', '2026-10-31 10:47:20');
        $this->beam($barina, '104', '104-C', '2026-10-31 10:48:30.000800', '2026-10-31 10:47:40');
        $this->note($barina, '104-C', '105x145', '2026-10-31 10:48:30.001000', '2026-10-31 10:47:50');
        $this->photo($barina, '104-C', '2026-10-31 10:48:30.001100', '2026-10-31 10:48:00');

        foreach (['48', '78', '86', '110', '111', '119', '126'] as $i => $tag) {
            $this->sawn($sawmill, $tag, \sprintf('2026-10-31 11:06:00.%06d', 100 * ($i + 1)), \sprintf('2026-10-31 10:%02d:00', 22 + $i));
        }
        $this->sawn($sawmill, '97', '2026-10-31 11:06:00.002000', '2026-10-31 10:31:00');
        $this->note($sawmill, '97', 'Nicht schneidbar, Durchmesser zu klein und krumm', '2026-10-31 11:06:00.002100', '2026-10-31 10:32:00');
        $this->sawn($sawmill, '125', '2026-10-31 11:06:00.002200', '2026-10-31 10:40:00');
        $this->beam($sawmill, '125', '125-A', '2026-10-31 11:06:00.002300', '2026-10-31 10:41:00');
        $this->beam($sawmill, '125', '125-B', '2026-10-31 11:06:00.002500', '2026-10-31 10:42:00');
        $this->photo($sawmill, '125-B', '2026-10-31 11:06:00.002700', '2026-10-31 10:44:00');

        $this->add($alexander, EventType::Voided, '1998', [], '2026-10-31 16:09:00.000000', reference: $created1998);
        $this->add($alexander, EventType::Voided, '1999', [], '2026-10-31 16:09:00.000000', reference: $created1999);
        $this->add($alexander, EventType::AttributeRecorded, '97', ['attribute_id' => $this->length->id->toRfc4122(), 'value' => $this->fourTen->id->toRfc4122()], '2026-11-03 09:09:00.000100', '2026-11-03 09:08:30');
        $this->add($alexander, EventType::AttributeRecorded, '97', ['attribute_id' => $this->diameter->id->toRfc4122(), 'value' => 32.5], '2026-11-03 09:09:00.000200', '2026-11-03 09:08:40');
        $this->add($alexander, EventType::AttributeRecorded, '97', ['attribute_id' => $this->felled->id->toRfc4122(), 'value' => '2026-10'], '2026-11-03 09:09:00.000300', '2026-11-03 09:08:50');
        $this->project();

        $response = $this->activity('?from=2026-10-31', 'Alexander Summa');

        self::assertSame(self::fixture(), $response);
    }

    private function createdEvent(string $tag): Uuid
    {
        return Uuid::fromBinary($this->em->getConnection()->fetchOne('SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ?', [$this->items[$tag]->toBinary(), 'created']));
    }

    /** @return array<string, mixed> */
    private static function fixture(): array
    {
        return json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/activity-response.json'), true, flags: \JSON_THROW_ON_ERROR);
    }

    public function testNothingRecordedIsAnEmptyList(): void
    {
        self::assertSame(['entries' => [], 'next_cursor' => null, 'entries_unfiltered' => 0, 'totals' => ['entries' => 0, 'events' => 0, 'photos' => 0, 'users' => 0], 'users' => []], $this->activity());
    }
}
