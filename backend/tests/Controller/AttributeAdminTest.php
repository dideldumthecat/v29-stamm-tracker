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
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;

/** GET/POST/PATCH/PUT /api/admin/attributes. */
class AttributeAdminTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private User $admin;
    private Attribute $sawn;
    private Attribute $notes;
    private Attribute $species;
    private AttributeOption $oak;
    private AttributeOption $beech;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist($this->admin = new User('Chef', UserRole::Admin, User::hashToken(User::normalizeToken('Chef-test-token'))));
        $this->em->persist(new User('Ada', UserRole::Superadmin, User::hashToken(User::normalizeToken('Ada-test-token'))));
        $this->em->persist(new User('Bruno', UserRole::User, User::hashToken(User::normalizeToken('Bruno-test-token'))));
        $this->em->persist($this->sawn = new Attribute('Gesägt', AttributeType::Boolean, sortOrder: 10, key: 'sawn'));
        $this->em->persist($this->notes = new Attribute('Notiz', AttributeType::Text, isSeries: true, sortOrder: 20));
        $this->em->persist($this->species = new Attribute('Holzart', AttributeType::Choice, sortOrder: 30, active: false));
        $this->em->persist($this->oak = new AttributeOption($this->species, 'Eiche', 10));
        $this->em->persist($this->beech = new AttributeOption($this->species, 'Buche', 20, false));
        $this->em->flush();
    }

    /**
     * @param array<string, mixed>|null $body
     *
     * @return array<string, mixed>
     */
    private function call(string $method, string $uri, ?array $body = null, string $as = 'Chef'): array
    {
        $this->client->getCookieJar()->clear();
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $as.'-test-token'));
        $this->client->jsonRequest($method, '/api/admin/attributes'.$uri, $body ?? []);

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

    /**
     * @param array<string, mixed> $override
     *
     * @return array<string, mixed>
     */
    private function create(array $override = []): array
    {
        return $this->call('POST', '', $override + ['name' => 'Neu', 'type' => 'text']);
    }

    /** A recorded value, on a voided item too: the events stay in the log. */
    private function record(Attribute $attribute, bool $voided = false): void
    {
        $item = Uuid::v7();
        $at = new \DateTimeImmutable();
        $created = new TimberItemEvent(Uuid::v7(), $item, EventType::Created, ['parent_id' => null], $at, $this->admin);
        $this->em->persist($created);
        $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::AttributeRecorded, ['attribute_id' => $attribute->id->toRfc4122(), 'value' => 'x'], $at, $this->admin));
        if ($voided) {
            $this->em->persist(new TimberItemEvent(Uuid::v7(), $item, EventType::Voided, [], $at, $this->admin, $created->id));
        }
        $this->em->flush();
    }

    public function testOnlyAdminsMayUseIt(): void
    {
        foreach ([['GET', ''], ['POST', ''], ['PATCH', '/'.$this->notes->id->toRfc4122()], ['PUT', '/order']] as [$method, $uri]) {
            $this->call($method, $uri, ['name' => 'X', 'type' => 'text'], 'Bruno');
            self::assertSame(403, $this->code(), $method);
        }
        self::assertSame(200, $this->call('GET', '', null, 'Ada') ? $this->code() : 0);
    }

    public function testListsEveryAttributeInOrderWithInactiveOptionsAndFlags(): void
    {
        $this->record($this->notes, voided: true);

        $list = $this->call('GET', '')['attributes'];

        self::assertSame(['Gesägt', 'Notiz', 'Holzart'], array_column($list, 'name'));
        self::assertSame([true, false, false], array_column($list, 'is_system'));
        self::assertSame([false, true, false], array_column($list, 'has_values'));
        self::assertSame(['Eiche', 'Buche'], array_column($list[2]['options'], 'label'));
        self::assertSame([true, false], array_column($list[2]['options'], 'active'));
        self::assertFalse($list[2]['active']);
    }

    public function testCreatesAtTheEnd(): void
    {
        $created = $this->create(['description' => ' Ein Test ', 'unit' => null, 'applies_to' => ['beam'], 'is_series' => true]);

        self::assertSame(201, $this->code());
        self::assertSame(['Neu', ' Ein Test ', 40, null, ['beam'], true, false, false], [
            $created['name'], $created['description'], $created['sort_order'], $created['key'], $created['applies_to'], $created['is_series'], $created['is_system'], $created['has_values'],
        ]);
        self::assertSame(['Gesägt', 'Notiz', 'Holzart', 'Neu'], array_column($this->call('GET', '')['attributes'], 'name'));
    }

    /**
     * @param array<string, mixed> $input
     * @param list<string>         $expected
     */
    #[DataProvider('invalidInput')]
    public function testRulesOfTheChecks(array $input, array $expected): void
    {
        $this->call('POST', '', $input);

        self::assertSame($expected, $this->errors());
        self::assertCount(3, $this->call('GET', '')['attributes'], 'nothing is written');
    }

    /** @return iterable<string, array{array<string, mixed>, list<string>}> */
    public static function invalidInput(): iterable
    {
        yield 'name missing' => [['type' => 'text'], ['name: Bitte einen Namen eingeben.']];
        yield 'name blank' => [['name' => '  ', 'type' => 'text'], ['name: Bitte einen Namen eingeben.']];
        yield 'name taken, ignoring case and spaces around' => [['name' => ' notiz ', 'type' => 'text'], ['name: Ein Merkmal mit diesem Namen gibt es schon.']];
        yield 'type missing' => [['name' => 'A'], ['type: Bitte einen Typ wählen.']];
        yield 'type photo' => [['name' => 'A', 'type' => 'photo', 'is_series' => true], ['type: Bitte einen Typ wählen.']];
        yield 'unit on text' => [['name' => 'A', 'type' => 'text', 'unit' => 'm'], ['unit: Eine Einheit gibt es nur bei Zahlen.']];
        yield 'applies to nothing' => [['name' => 'A', 'type' => 'text', 'applies_to' => []], ['applies_to: Bitte mindestens Stamm oder Balken wählen.']];
        yield 'applies to something else' => [['name' => 'A', 'type' => 'text', 'applies_to' => ['plank']], ['applies_to: Bitte mindestens Stamm oder Balken wählen.']];
        yield 'hidden when an unknown id' => [['name' => 'A', 'type' => 'text', 'hidden_when' => ['nowhere']], ['hidden_when: Ausblenden ist nur bei anderen Ja-Nein-Merkmalen möglich.']];
        yield 'hidden when a key instead of an id' => [['name' => 'A', 'type' => 'text', 'hidden_when' => ['sawn']], ['hidden_when: Ausblenden ist nur bei anderen Ja-Nein-Merkmalen möglich.']];
        yield 'series of a choice' => [['name' => 'A', 'type' => 'choice', 'is_series' => true, 'options' => [['label' => 'X']]], ['is_series: Bei Auswahl und Ja/Nein gibt es keine Messreihe.']];
        yield 'series of a boolean' => [['name' => 'A', 'type' => 'boolean', 'is_series' => true], ['is_series: Bei Auswahl und Ja/Nein gibt es keine Messreihe.']];
        yield 'choice without options' => [['name' => 'A', 'type' => 'choice'], ['options: Bitte mindestens eine aktive Auswahl-Option anlegen.']];
        yield 'choice with inactive options only' => [['name' => 'A', 'type' => 'choice', 'options' => [['label' => 'X', 'active' => false]]], ['options: Bitte mindestens eine aktive Auswahl-Option anlegen.']];
        yield 'blank option' => [['name' => 'A', 'type' => 'choice', 'options' => [['label' => 'X'], ['label' => ' ']]], ['options.1.label: Bitte einen Namen für die Auswahl-Option eingeben.']];
        yield 'option twice, trimmed' => [['name' => 'A', 'type' => 'choice', 'options' => [['label' => 'X'], ['label' => ' X ']]], ['options.1.label: Die Auswahl-Option „X“ gibt es schon.']];
    }

    public function testFieldsOfAValidAttributeAreTrimmedAndHiddenWhenMayNameAYesNoAttribute(): void
    {
        $sawn = $this->sawn->id->toRfc4122();
        $created = $this->create(['name' => '  Länge ', 'type' => 'number', 'unit' => ' m ', 'hidden_when' => [$sawn]]);

        self::assertSame(['Länge', 'm', [$sawn]], [$created['name'], $created['unit'], $created['hidden_when']]);
    }

    public function testHiddenWhenMayNameAYesNoAttributeWithoutKey(): void
    {
        $debarked = $this->create(['name' => 'Entrindet', 'type' => 'boolean']);
        self::assertNull($debarked['key']);

        $created = $this->create(['name' => 'Rinde', 'type' => 'text', 'hidden_when' => [$debarked['id']]]);

        self::assertSame([$debarked['id']], $created['hidden_when']);
    }

    public function testHiddenWhenRefusesATextAttributeAndTheAttributeItself(): void
    {
        $this->call('POST', '', ['name' => 'A', 'type' => 'text', 'hidden_when' => [$this->notes->id->toRfc4122()]]);
        self::assertSame(['hidden_when: Ausblenden ist nur bei anderen Ja-Nein-Merkmalen möglich.'], $this->errors());

        $this->call('PATCH', '/'.$this->sawn->id->toRfc4122(), ['hidden_when' => [$this->sawn->id->toRfc4122()]]);
        self::assertSame(['hidden_when: Bei Systemmerkmalen ist das im Code festgelegt.'], $this->errors());

        $entrindet = $this->create(['name' => 'Entrindet', 'type' => 'boolean']);
        $this->call('PATCH', '/'.$entrindet['id'], ['hidden_when' => [$entrindet['id']]]);
        self::assertSame(['hidden_when: Ausblenden ist nur bei anderen Ja-Nein-Merkmalen möglich.'], $this->errors());
    }

    public function testChoiceKeepsTheOrderOfItsOptions(): void
    {
        $created = $this->create(['name' => 'Farbe', 'type' => 'choice', 'options' => [['label' => 'Rot'], ['label' => ' Blau ', 'active' => false]]]);

        self::assertSame([['Rot', 10, true], ['Blau', 20, false]], array_map(static fn (array $o) => [$o['label'], $o['sort_order'], $o['active']], $created['options']));
    }

    public function testPatchChangesFieldsAndKeepsWhatIsNotSent(): void
    {
        $sawn = $this->sawn->id->toRfc4122();
        $updated = $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), ['name' => 'Bemerkung', 'description' => 'Frei', 'active' => false, 'applies_to' => ['stem'], 'hidden_when' => [$sawn]]);

        self::assertSame(200, $this->code());
        self::assertSame(['Bemerkung', 'Frei', false, ['stem'], [$sawn], 'text', true], [$updated['name'], $updated['description'], $updated['active'], $updated['applies_to'], $updated['hidden_when'], $updated['type'], $updated['is_series']]);
    }

    public function testPatchMayKeepItsOwnNameButNotTakeAnotherOne(): void
    {
        $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), ['name' => 'Notiz', 'description' => 'x']);
        self::assertSame(200, $this->code());

        $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), ['name' => 'holzart']);
        self::assertSame(['name: Ein Merkmal mit diesem Namen gibt es schon.'], $this->errors());
    }

    public function testNothingIsRefusedForAnUnknownAttributeOrBody(): void
    {
        $this->call('PATCH', '/'.Uuid::v7()->toRfc4122(), ['name' => 'X']);
        self::assertSame(404, $this->code());
        $this->call('PATCH', '/nonsense', ['name' => 'X']);
        self::assertSame(404, $this->code());
        $this->client->request('POST', '/api/admin/attributes', server: ['HTTP_COOKIE' => SessionController::COOKIE.'=Chef-test-token'], content: '[1,2]');
        self::assertSame(400, $this->code());
    }

    public function testSystemAttributeNameAndDescriptionCanBeChanged(): void
    {
        $this->call('PATCH', '/'.$this->sawn->id->toRfc4122(), ['name' => 'Gesägt (fertig)', 'description' => 'Fertig gesägt']);

        self::assertSame(200, $this->code());
        $first = $this->call('GET', '')['attributes'][0];
        self::assertSame(['Gesägt (fertig)', 'Fertig gesägt', 'sawn'], [$first['name'], $first['description'], $first['key']]);
    }

    public function testSystemAttributeKeepsEverythingElseEvenWhenTheWholeFormIsSent(): void
    {
        $current = $this->call('GET', '')['attributes'][0];
        $this->call('PATCH', '/'.$this->sawn->id->toRfc4122(), ['name' => 'Anders'] + $current);

        self::assertSame(200, $this->code());
    }

    #[DataProvider('systemLockedFields')]
    public function testSystemAttributeRefusesChangesToTheRest(string $field, mixed $value): void
    {
        $this->call('PATCH', '/'.$this->sawn->id->toRfc4122(), ['name' => 'Anders', $field => $value]);

        self::assertSame([$field.': Bei Systemmerkmalen ist das im Code festgelegt.'], $this->errors());
        self::assertSame('Gesägt', $this->call('GET', '')['attributes'][0]['name']);
    }

    /** @return iterable<string, array{string, mixed}> */
    public static function systemLockedFields(): iterable
    {
        yield 'type' => ['type', 'text'];
        yield 'unit' => ['unit', 'cm'];
        yield 'series' => ['is_series', true];
        yield 'inheritable' => ['is_inheritable', true];
        yield 'applies to' => ['applies_to', ['beam']];
        yield 'hidden when' => ['hidden_when', ['sawn']];
        yield 'active' => ['active', false];
        yield 'options' => ['options', [['label' => 'Neu']]];
    }

    #[DataProvider('lockedFields')]
    public function testValuesLockTypeSeriesAndInheritance(string $field, mixed $value): void
    {
        $this->record($this->notes, voided: true);

        $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), [$field => $value]);

        self::assertSame(["$field: Das lässt sich nicht mehr ändern, weil schon Werte erfasst sind."], $this->errors());
    }

    /** @return iterable<string, array{string, mixed}> */
    public static function lockedFields(): iterable
    {
        yield 'type' => ['type', 'number'];
        yield 'is_series' => ['is_series', false];
        yield 'is_inheritable' => ['is_inheritable', true];
    }

    public function testValuesStillAllowEverythingElse(): void
    {
        $this->record($this->notes);

        $updated = $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), ['type' => 'text', 'is_series' => true, 'is_inheritable' => false,
            'name' => 'Neu', 'description' => 'd', 'applies_to' => ['beam'], 'hidden_when' => [$this->sawn->id->toRfc4122()], 'active' => false]);

        self::assertSame(200, $this->code());
        self::assertSame(['Neu', true], [$updated['name'], $updated['has_values']]);
    }

    public function testWithoutValuesTypeInheritanceAndSeriesChange(): void
    {
        $updated = $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), ['type' => 'number', 'unit' => 'cm', 'is_inheritable' => true]);

        self::assertSame(200, $this->code());
        self::assertSame(['number', 'cm', true], [$updated['type'], $updated['unit'], $updated['is_inheritable']]);
    }

    public function testOptionsCanBeAddedRenamedDeactivatedAndReordered(): void
    {
        $this->record($this->species);
        $id = $this->species->id->toRfc4122();

        $updated = $this->call('PATCH', "/$id", ['options' => [
            ['id' => $this->beech->id->toRfc4122(), 'label' => ' Rotbuche ', 'active' => true],
            ['label' => 'Esche'],
            ['id' => $this->oak->id->toRfc4122(), 'label' => 'Eiche', 'active' => false],
        ]]);

        self::assertSame(200, $this->code());
        self::assertSame([['Rotbuche', 10, true, $this->beech->id->toRfc4122()], ['Esche', 20, true, null], ['Eiche', 30, false, $this->oak->id->toRfc4122()]],
            array_map(static fn (array $o) => [$o['label'], $o['sort_order'], $o['active'], 'Esche' === $o['label'] ? null : $o['id']], $updated['options']));
    }

    public function testAnExistingOptionCannotBeLeftOut(): void
    {
        $this->call('PATCH', '/'.$this->species->id->toRfc4122(), ['options' => [['id' => $this->oak->id->toRfc4122(), 'label' => 'Eiche']]]);

        self::assertSame(['options: Bestehende Auswahl-Optionen dürfen nicht fehlen; sie lassen sich nur deaktivieren.'], $this->errors());
        $this->em->clear();
        self::assertCount(2, $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $this->species]));
    }

    public function testOptionIdsMustBelongToTheAttributeAndAtLeastOneStaysActive(): void
    {
        $this->call('PATCH', '/'.$this->species->id->toRfc4122(), ['options' => [
            ['id' => $this->oak->id->toRfc4122(), 'label' => 'Eiche', 'active' => false],
            ['id' => $this->beech->id->toRfc4122(), 'label' => 'Buche', 'active' => false],
            ['id' => Uuid::v7()->toRfc4122(), 'label' => 'Fremd'],
        ]]);
        self::assertSame(['options.2.id: Diese Auswahl-Option gehört nicht zum Merkmal.', 'options: Bestehende Auswahl-Optionen dürfen nicht fehlen; sie lassen sich nur deaktivieren.'][0], $this->errors()[0]);

        $this->call('PATCH', '/'.$this->species->id->toRfc4122(), ['options' => [
            ['id' => $this->oak->id->toRfc4122(), 'label' => 'Eiche', 'active' => false],
            ['id' => $this->beech->id->toRfc4122(), 'label' => 'Buche', 'active' => false],
        ]]);
        self::assertSame(['options: Bitte mindestens eine aktive Auswahl-Option anlegen.'], $this->errors());
    }

    public function testOrderingIncludesSystemAttributes(): void
    {
        $ids = array_map(static fn (Attribute $a) => $a->id->toRfc4122(), [$this->species, $this->sawn, $this->notes]);

        $list = $this->call('PUT', '/order', ['ids' => $ids])['attributes'];

        self::assertSame(200, $this->code());
        self::assertSame(['Holzart', 'Gesägt', 'Notiz'], array_column($list, 'name'));
        self::assertSame(['Holzart', 'Gesägt', 'Notiz'], array_column($this->call('GET', '')['attributes'], 'name'));
    }

    /** @param \Closure(self): list<string> $ids */
    #[DataProvider('invalidOrders')]
    public function testOrderMustListEveryAttributeOnce(\Closure $ids): void
    {
        $this->call('PUT', '/order', ['ids' => $ids($this)]);

        self::assertSame(['ids: Die Reihenfolge muss jedes Merkmal genau einmal enthalten.'], $this->errors());
        self::assertSame(['Gesägt', 'Notiz', 'Holzart'], array_column($this->call('GET', '')['attributes'], 'name'));
    }

    /** @return iterable<string, array{\Closure}> */
    public static function invalidOrders(): iterable
    {
        yield 'one missing' => [static fn (self $t) => [$t->notes->id->toRfc4122(), $t->sawn->id->toRfc4122()]];
        yield 'one twice' => [static fn (self $t) => [$t->notes->id->toRfc4122(), $t->notes->id->toRfc4122(), $t->sawn->id->toRfc4122()]];
        yield 'one unknown' => [static fn (self $t) => [$t->notes->id->toRfc4122(), $t->sawn->id->toRfc4122(), Uuid::v7()->toRfc4122()]];
    }

    public function testChangesLeaveNoEvents(): void
    {
        $before = $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events');

        $this->create();
        $this->call('PATCH', '/'.$this->notes->id->toRfc4122(), ['description' => 'x']);

        self::assertEquals($before, $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM timber_item_events'));
    }
}
