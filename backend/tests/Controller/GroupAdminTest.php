<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\User;
use App\Entity\UserGroup;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;

/** GET/POST/PATCH/DELETE /api/admin/groups; the fixture admin-groups-response.json is the expected list. */
class GroupAdminTest extends WebTestCase
{
    private const string V29 = '00000000-0000-7000-8000-0000000000a1';
    private const string SAWMILL = '00000000-0000-7000-8000-0000000000a2';
    private const string HOLZART = '0847b35f-f94e-4f68-84c6-63426a5dcf77';
    private const string FAELLDATUM = 'a222dbf7-15cd-44cd-92c9-18969c610238';

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private Attribute $spare;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->em->persist($v29 = new UserGroup('V29', true, Uuid::fromString(self::V29)));
        $this->em->persist($sawmill = new UserGroup('Sägewerk', false, Uuid::fromString(self::SAWMILL)));
        foreach ([[self::HOLZART, 'Holzart', 10], [self::FAELLDATUM, 'Fälldatum', 20]] as [$id, $name, $order]) {
            $this->em->persist($attribute = new Attribute($name, AttributeType::Text, sortOrder: $order, id: Uuid::fromString($id)));
            $sawmill->enable([...$sawmill->attributes, $attribute]);
        }
        $this->em->persist($this->spare = new Attribute('Notiz', AttributeType::Text, sortOrder: 30));
        // The ids are those of the fixture admin-users-response.json.
        foreach ([[1, 'Ada', UserRole::Superadmin, $v29], [2, 'Chef', UserRole::Admin, $v29], [3, 'Bruno', UserRole::User, $sawmill],
            [4, 'Cem', UserRole::User, $sawmill], [5, 'Dora', UserRole::User, $v29]] as [$number, $name, $role, $group]) {
            $this->em->persist(new User($name, $role, $group, User::hashToken(User::normalizeToken($name.'-test-token')), id: Uuid::fromString(\sprintf('00000000-0000-7000-8000-%012d', $number))));
        }
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
        $this->client->jsonRequest($method, '/api/admin/groups'.$uri, $body ?? []);

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    /** @return list<string> "field: message" of a 422 */
    private function errors(): array
    {
        self::assertResponseStatusCodeSame(422);

        return array_map(static fn (array $e) => $e['field'].': '.$e['message'], json_decode($this->client->getResponse()->getContent(), true)['errors']);
    }

    private function names(): string
    {
        return implode(', ', array_column($this->call('GET')['groups'], 'name'));
    }

    public function testOnlyAdminsMayUseIt(): void
    {
        foreach ([['GET', ''], ['POST', ''], ['PATCH', '/x'], ['DELETE', '/x']] as [$method, $uri]) {
            $this->client->getCookieJar()->clear();
            $this->client->jsonRequest($method, '/api/admin/groups'.$uri, []);
            self::assertResponseStatusCodeSame(401, $method.$uri);
        }
        $this->call('GET', as: 'Bruno');
        self::assertResponseStatusCodeSame(403);
    }

    public function testListMatchesTheFixture(): void
    {
        $expected = json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/admin-groups-response.json'), true, flags: \JSON_THROW_ON_ERROR);

        self::assertSame($expected, $this->call('GET'));
    }

    public function testCreateAGroupWithAttributes(): void
    {
        $body = $this->call('POST', body: ['name' => ' Forst ', 'sees_all_attributes' => false, 'attribute_ids' => [self::FAELLDATUM, self::HOLZART, self::HOLZART]]);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(['Forst', false, [self::HOLZART, self::FAELLDATUM], []], [$body['name'], $body['sees_all_attributes'], $body['attribute_ids'], $body['users']]);
        self::assertSame('Forst, Sägewerk, V29', $this->names());
    }

    public function testANewGroupSeesOnlyTheEnabledAttributesAndNoneYet(): void
    {
        $body = $this->call('POST', body: ['name' => 'Forst']);

        self::assertSame([false, []], [$body['sees_all_attributes'], $body['attribute_ids']]);
    }

    public function testAGroupThatSeesAllKeepsNoList(): void
    {
        $body = $this->call('PATCH', '/'.self::SAWMILL, ['sees_all_attributes' => true]);

        self::assertResponseIsSuccessful();
        self::assertSame([true, []], [$body['sees_all_attributes'], $body['attribute_ids']]);
        $body = $this->call('PATCH', '/'.self::SAWMILL, ['sees_all_attributes' => false]);
        self::assertSame([], $body['attribute_ids'], 'the list does not come back');
    }

    public function testUpdateLeavesOutFieldsAsTheyAre(): void
    {
        $body = $this->call('PATCH', '/'.self::SAWMILL, ['name' => 'Sägerei']);

        self::assertSame(['Sägerei', false, [self::HOLZART, self::FAELLDATUM]], [$body['name'], $body['sees_all_attributes'], $body['attribute_ids']]);

        $body = $this->call('PATCH', '/'.self::SAWMILL, ['attribute_ids' => [$this->spare->id->toRfc4122()]]);
        self::assertSame(['Sägerei', [$this->spare->id->toRfc4122()]], [$body['name'], $body['attribute_ids']]);
    }

    public function testNameIsRequiredTrimmedAndUnique(): void
    {
        $this->call('POST', body: ['name' => '  ']);
        self::assertSame(['name: Bitte einen Namen eingeben.'], $this->errors());
        $this->call('POST', body: ['name' => str_repeat('x', 256)]);
        self::assertSame(['name: Der Name darf höchstens 255 Zeichen lang sein.'], $this->errors());
        $this->call('POST', body: ['name' => ' v29 ']);
        self::assertSame(['name: Diese Gruppe gibt es schon.'], $this->errors());
        $this->call('PATCH', '/'.self::SAWMILL, ['name' => 'V29']);
        self::assertSame(['name: Diese Gruppe gibt es schon.'], $this->errors());
        // its own name is no clash
        $this->call('PATCH', '/'.self::SAWMILL, ['name' => 'Sägewerk', 'sees_all_attributes' => true]);
        self::assertResponseIsSuccessful();
        self::assertSame('Sägewerk, V29', $this->names());
    }

    public function testRefusesUnknownAttributesAndMalformedFields(): void
    {
        $this->call('PATCH', '/'.self::SAWMILL, ['attribute_ids' => [self::HOLZART, '00000000-0000-7000-8000-0000000000ff']]);
        self::assertSame(['attribute_ids: Ein ausgewähltes Merkmal gibt es nicht.'], $this->errors());
        $this->call('PATCH', '/'.self::SAWMILL, ['attribute_ids' => 'all', 'sees_all_attributes' => 'yes']);
        self::assertSame(['sees_all_attributes: Der Wert muss wahr oder falsch sein.', 'attribute_ids: Die Merkmale müssen eine Liste von IDs sein.'], $this->errors());
        $this->call('POST', body: ['name' => 'Forst', 'attribute_ids' => ['nope']]);
        self::assertSame(['attribute_ids: Ein ausgewähltes Merkmal gibt es nicht.'], $this->errors());

        self::assertSame('Sägewerk, V29', $this->names(), 'nothing was created or changed');
        self::assertCount(2, $this->call('GET')['groups'][0]['attribute_ids']);
    }

    public function testUnknownGroupIs404(): void
    {
        foreach (['PATCH', 'DELETE'] as $method) {
            foreach (['/nope', '/00000000-0000-7000-8000-0000000000ff'] as $uri) {
                $this->call($method, $uri, []);
                self::assertResponseStatusCodeSame(404, $method.$uri);
            }
        }
    }

    public function testAGroupWithUsersIsNotDeleted(): void
    {
        $this->call('DELETE', '/'.self::SAWMILL);

        self::assertResponseStatusCodeSame(409);
        self::assertSame('Sägewerk, V29', $this->names());
    }

    public function testAnEmptyGroupIsDeletedWithItsAttributeList(): void
    {
        $id = $this->call('POST', body: ['name' => 'Forst', 'attribute_ids' => [self::HOLZART]])['id'];

        $this->call('DELETE', '/'.$id);

        self::assertResponseStatusCodeSame(204);
        self::assertSame('Sägewerk, V29', $this->names());
        self::assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM user_group_attributes WHERE group_id = ?', [Uuid::fromString($id)->toBinary()]));
    }

    public function testDeletingAnAttributeLeavesTheGroupsAlone(): void
    {
        $this->em->getConnection()->executeStatement('DELETE FROM attributes WHERE id = ?', [Uuid::fromString(self::HOLZART)->toBinary()]);
        $this->em->clear();

        self::assertSame([self::FAELLDATUM], $this->call('GET')['groups'][0]['attribute_ids']);
    }
}
