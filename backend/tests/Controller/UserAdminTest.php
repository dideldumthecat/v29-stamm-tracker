<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
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

/** GET/POST/PATCH /api/admin/users and POST /invite: who may do what, the invite code, blocking. */
class UserAdminTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    /** @var array<string, User> by name */
    private array $users = [];

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        // The ids and times are those of the fixture admin-users-response.json.
        $this->add('Ada', UserRole::Superadmin, 1, '2026-10-20 08:00:00');
        $this->add('Chef', UserRole::Admin, 2, '2026-10-21 08:00:00');
        $this->add('Bruno', UserRole::User, 3, '2026-10-22 08:00:00', code: 'K7QM4XHT9RDP');
        $this->add('Cem', UserRole::User, 4, '2026-10-23 08:00:00', revoked: '2026-11-05 12:00:00');
        $this->add('Dora', UserRole::User, 5, '2026-10-24 08:00:00');
        $this->event($this->users['Ada'], '2026-11-12 16:30:00');
        $this->event($this->users['Bruno'], '2026-11-13 09:15:00');
        $this->event($this->users['Bruno'], '2026-11-10 09:15:00');
        $this->em->flush();
    }

    private function add(string $name, UserRole $role, int $number, string $created, ?string $code = null, ?string $revoked = null): void
    {
        $user = new User(
            $name,
            $role,
            User::hashToken(User::normalizeToken($name.'-test-token')),
            new \DateTimeImmutable($created, new \DateTimeZone('UTC')),
            $revoked ? new \DateTimeImmutable($revoked, new \DateTimeZone('UTC')) : null,
            Uuid::fromString(\sprintf('00000000-0000-7000-8000-%012d', $number)),
        );
        // The sign-in cookie of the test is the code of the user
        $this->codes[$name] = $code ?? $name.'-test-token';
        $user->tokenHash = User::hashToken(User::normalizeToken($this->codes[$name]));
        $this->em->persist($user);
        $this->users[$name] = $user;
    }

    /** @var array<string, string> the code (cookie) each user signs in with */
    private array $codes = [];

    private function event(User $user, string $received): void
    {
        $at = new \DateTimeImmutable($received, new \DateTimeZone('UTC'));
        $this->em->persist(new TimberItemEvent(Uuid::v7(), Uuid::v7(), EventType::Created, ['parent_id' => null], $at, $user, null, $at));
    }

    /**
     * @param array<string, mixed>|null $body
     *
     * @return array<string, mixed>
     */
    private function call(string $method, string $uri, ?array $body = null, string $as = 'Ada'): array
    {
        $this->client->getCookieJar()->clear();
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $this->codes[$as]));
        $this->client->jsonRequest($method, '/api/admin/users'.$uri, $body ?? []);

        return json_decode($this->client->getResponse()->getContent(), true) ?? [];
    }

    private function code(): int
    {
        return $this->client->getResponse()->getStatusCode();
    }

    private function id(string $name): string
    {
        return '/'.$this->users[$name]->id->toRfc4122();
    }

    /** @return list<string> "field: message" of a 422 */
    private function errors(): array
    {
        self::assertSame(422, $this->code());
        $body = json_decode($this->client->getResponse()->getContent(), true);

        return array_map(static fn (array $e) => $e['field'].': '.$e['message'], $body['errors']);
    }

    /** Does the code open the account? (The sign-in of the app.) */
    private function signsIn(string $code): bool
    {
        $this->client->jsonRequest('POST', '/api/session', ['token' => $code]);

        return 200 === $this->code();
    }

    /** @return array<string, mixed> */
    private static function fixture(string $name): array
    {
        return json_decode(file_get_contents(__DIR__.'/../../../frontend/shared/fixtures/'.$name.'.json'), true, flags: \JSON_THROW_ON_ERROR);
    }

    public function testOnlyAdminsMayUseIt(): void
    {
        foreach ([['GET', ''], ['POST', ''], ['PATCH', '/x'], ['POST', '/x/invite']] as [$method, $uri]) {
            $this->client->getCookieJar()->clear();
            $this->client->jsonRequest($method, '/api/admin/users'.$uri, []);
            self::assertSame(401, $this->code(), $method.$uri);
        }
        $this->call('GET', '', as: 'Bruno');
        self::assertSame(403, $this->code());
    }

    public function testListMatchesTheFixtureForTheSuperadmin(): void
    {
        self::assertSame(self::fixture('admin-users-response'), $this->call('GET', ''));
    }

    public function testListForAnAdminLimitsWhatMayBeDone(): void
    {
        $body = $this->call('GET', '', as: 'Chef');

        self::assertSame(['user'], $body['creatable_roles']);
        $flags = array_column($body['users'], null, 'name');
        // can_manage, can_block, can_set_role
        self::assertSame([false, false, false], [$flags['Ada']['can_manage'], $flags['Ada']['can_block'], $flags['Ada']['can_set_role']]);
        self::assertSame([false, false, false], [$flags['Chef']['can_manage'], $flags['Chef']['can_block'], $flags['Chef']['can_set_role']]);
        self::assertSame([true, true, false], [$flags['Bruno']['can_manage'], $flags['Bruno']['can_block'], $flags['Bruno']['can_set_role']]);
    }

    public function testListNeverContainsCodesOrHashes(): void
    {
        $this->call('GET', '');

        $text = $this->client->getResponse()->getContent();
        self::assertStringNotContainsString('K7QM', $text);
        self::assertStringNotContainsString($this->users['Bruno']->tokenHash, $text);
        self::assertStringNotContainsString('invite_code', $text);
    }

    public function testCreateAUserShowsTheInviteAndTheCodeSignsIn(): void
    {
        $body = $this->call('POST', '', ['name' => ' Eva ', 'role' => 'user'], as: 'Chef');

        self::assertSame(201, $this->code());
        self::assertSame(['Eva', 'user'], [$body['user']['name'], $body['user']['role']]);
        self::assertSame(['code'], array_keys($body['invite']));
        self::assertMatchesRegularExpression('~^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$~', $body['invite']['code']);
        self::assertTrue($this->signsIn($body['invite']['code']));
        // and nothing shows it again
        $this->call('GET', '/'.$body['user']['id'].'/invite', as: 'Chef');
        self::assertSame(405, $this->code());
    }

    public function testOnlyTheSuperadminCreatesAdministrators(): void
    {
        $this->call('POST', '', ['name' => 'Fred', 'role' => 'admin'], as: 'Chef');
        self::assertSame(403, $this->code());

        $this->call('POST', '', ['name' => 'Fred', 'role' => 'admin']);
        self::assertSame(201, $this->code());
    }

    /** @param array<string, mixed> $body */
    #[DataProvider('invalidCreations')]
    public function testCreateChecksNameAndRole(array $body, string $error): void
    {
        $this->call('POST', '', $body);

        self::assertSame([$error], $this->errors());
        self::assertCount(5, $this->em->getRepository(User::class)->findAll());
    }

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function invalidCreations(): iterable
    {
        yield 'no name' => [['name' => '  ', 'role' => 'user'], 'name: Bitte einen Namen eingeben.'];
        yield 'long name' => [['name' => str_repeat('x', 256), 'role' => 'user'], 'name: Der Name darf höchstens 255 Zeichen lang sein.'];
        yield 'no role' => [['name' => 'Fred'], 'role: Bitte eine Rolle wählen.'];
        yield 'unknown role' => [['name' => 'Fred', 'role' => 'boss'], 'role: Bitte eine Rolle wählen.'];
        yield 'nobody creates a superadmin' => [['name' => 'Fred', 'role' => 'superadmin'], 'role: Bitte eine Rolle wählen.'];
    }

    public function testRename(): void
    {
        $body = $this->call('PATCH', $this->id('Bruno'), ['name' => ' Brunhild '], as: 'Chef');

        self::assertSame(200, $this->code());
        self::assertSame('Brunhild', $body['user']['name']);
        $this->call('PATCH', $this->id('Bruno'), ['name' => ''], as: 'Chef');
        self::assertSame(['name: Bitte einen Namen eingeben.'], $this->errors());
    }

    public function testAnAdminCannotChangeAnAdministratorButTheSuperadminCan(): void
    {
        $this->call('PATCH', $this->id('Chef'), ['name' => 'Boss'], as: 'Chef');
        self::assertSame(403, $this->code());
        $this->call('POST', $this->id('Chef').'/invite', as: 'Chef');
        self::assertSame(403, $this->code());

        $this->call('PATCH', $this->id('Chef'), ['name' => 'Boss']);
        self::assertSame(200, $this->code());
    }

    #[DataProvider('everyone')]
    public function testNobodyChangesTheSuperadmin(string $as): void
    {
        foreach ([['PATCH', '', ['name' => 'X']], ['PATCH', '', ['blocked' => true]], ['PATCH', '', ['role' => 'user']], ['POST', '/invite', null]] as [$method, $uri, $body]) {
            $this->call($method, $this->id('Ada').$uri, $body, as: $as);
            self::assertSame(403, $this->code(), "$as $method $uri");
        }
        self::assertNull($this->users['Ada']->revokedAt);
    }

    /** @return iterable<string, array{string}> */
    public static function everyone(): iterable
    {
        yield 'an admin' => ['Chef'];
        yield 'the superadmin' => ['Ada'];
    }

    public function testBlockAndUnblock(): void
    {
        $code = $this->codes['Bruno'];
        self::assertTrue($this->signsIn($code));

        $body = $this->call('PATCH', $this->id('Bruno'), ['blocked' => true], as: 'Chef');
        self::assertSame(200, $this->code());
        self::assertNotNull($body['user']['revoked_at']);
        self::assertFalse($this->signsIn($code));

        $body = $this->call('PATCH', $this->id('Bruno'), ['blocked' => false], as: 'Chef');
        self::assertNull($body['user']['revoked_at']);
        self::assertTrue($this->signsIn($code), 'the same code works again');
    }

    public function testBlockingAgainKeepsTheFirstTime(): void
    {
        $body = $this->call('PATCH', $this->id('Cem'), ['blocked' => true], as: 'Chef');

        self::assertSame('2026-11-05T12:00:00.000Z', $body['user']['revoked_at']);
    }

    public function testNobodyBlocksThemselves(): void
    {
        foreach (['Ada', 'Chef'] as $name) {
            $this->call('PATCH', $this->id($name), ['blocked' => true], as: $name);
            self::assertSame(403, $this->code(), $name);
        }
    }

    public function testBlockingAnAdminNeedsTheSuperadmin(): void
    {
        $this->call('PATCH', $this->id('Chef'), ['blocked' => true], as: 'Chef');
        self::assertSame(403, $this->code());

        $this->call('PATCH', $this->id('Chef'), ['blocked' => true]);
        self::assertSame(200, $this->code());
        $this->call('GET', '', as: 'Chef');
        self::assertSame(401, $this->code(), 'a blocked administrator is out at once');
    }

    public function testOnlyTheSuperadminGivesAndTakesTheAdminRole(): void
    {
        $this->call('PATCH', $this->id('Bruno'), ['role' => 'admin'], as: 'Chef');
        self::assertSame(403, $this->code());

        $body = $this->call('PATCH', $this->id('Bruno'), ['role' => 'admin']);
        self::assertSame(200, $this->code());
        self::assertSame('admin', $body['user']['role']);
        $this->call('GET', '', as: 'Bruno');
        self::assertSame(200, $this->code(), 'the new administrator is let in');

        $this->call('PATCH', $this->id('Bruno'), ['role' => 'user'], as: 'Chef');
        self::assertSame(403, $this->code());
        $this->call('PATCH', $this->id('Bruno'), ['role' => 'user']);
        self::assertSame('user', json_decode($this->client->getResponse()->getContent(), true)['user']['role']);
    }

    public function testTheSameRoleIsNoChange(): void
    {
        $this->call('PATCH', $this->id('Bruno'), ['role' => 'user', 'name' => 'Brunhild'], as: 'Chef');

        self::assertSame(200, $this->code());
    }

    public function testNobodyMakesASuperadmin(): void
    {
        $this->call('PATCH', $this->id('Bruno'), ['role' => 'superadmin']);

        self::assertSame(['role: Bitte eine Rolle wählen.'], $this->errors());
    }

    public function testInviteOfABlockedUserIsRefused(): void
    {
        $this->call('POST', $this->id('Cem').'/invite');

        self::assertSame(409, $this->code());
    }

    public function testListAndSingleUserNeverShowAnInvite(): void
    {
        $list = $this->call('GET', '');
        self::assertStringNotContainsString('invite', json_encode($list, \JSON_THROW_ON_ERROR));
        $this->call('GET', $this->id('Bruno').'/invite');
        self::assertSame(405, $this->code());
    }

    public function testNewCodeInvalidatesTheOldCode(): void
    {
        $old = $this->codes['Bruno'];
        self::assertTrue($this->signsIn($old));

        $body = $this->call('POST', $this->id('Bruno').'/invite');

        self::assertSame(200, $this->code());
        self::assertNotSame('K7QM-4XHT-9RDP', $body['invite']['code']);
        self::assertSame(self::fixture('admin-user-invite-response')['user'], $body['user']);
        self::assertSame(['code'], array_keys($body['invite']));
        self::assertFalse($this->signsIn($old));
        self::assertTrue($this->signsIn($body['invite']['code']));
        // a cookie with the old code is out
        $this->client->getCookieJar()->clear();
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $old));
        $this->client->request('GET', '/api/snapshot');
        self::assertSame(401, $this->code());
    }

    public function testUnknownUsers(): void
    {
        foreach ([['PATCH', '/nonsense'], ['POST', '/nonsense/invite'], ['PATCH', '/'.Uuid::v7()->toRfc4122()], ['POST', '/'.Uuid::v7()->toRfc4122().'/invite']] as [$method, $uri]) {
            $this->call($method, $uri, ['name' => 'X']);
            self::assertSame(404, $this->code(), $method.$uri);
        }
    }

    public function testTheBodyMustBeAnObject(): void
    {
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, $this->codes['Ada']));
        $this->client->request('POST', '/api/admin/users', content: '[1,2]');

        self::assertSame(400, $this->code());
    }
}
