<?php

namespace App\Tests\Command;

use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Uid\Uuid;

/**
 * Every test runs in a transaction that DAMA rolls back, so nothing stays in the test database.
 */
class UserCommandsTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Application $application;

    protected function setUp(): void
    {
        $kernel = self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        $this->application = new Application($kernel);
    }

    private function execute(string $command, array $input): CommandTester
    {
        $tester = new CommandTester($this->application->find($command));
        $tester->execute($input);

        return $tester;
    }

    private function code(string $display): string
    {
        preg_match('~Dein Code: (\S+)~', $display, $match);

        return $match[1];
    }

    private function users(): array
    {
        $this->em->clear();

        return $this->em->getRepository(User::class)->findAll();
    }

    public function testCreatePrintsInviteMessageAndStoresOnlyTheHash(): void
    {
        $tester = $this->execute('app:user:create', ['name' => ' Kerstin ']);

        self::assertSame(Command::SUCCESS, $tester->getStatusCode());
        $display = $tester->getDisplay();
        self::assertStringContainsString('Hallo Kerstin,', $display);
        self::assertStringContainsString('Adresse: https://v29-stamm-tracker.ddev.site/'."\n", $display);
        self::assertStringContainsString('Bitte immer über das Symbol öffnen', $display);
        $group = '[0-9A-HJKMNP-TV-Z]{4}';
        self::assertMatchesRegularExpression("~Dein Code: $group-$group-$group \\(nicht weitergeben\\)~", $display);
        $token = str_replace('-', '', $this->code($display));

        $users = $this->users();
        self::assertCount(1, $users);
        self::assertSame('Kerstin', $users[0]->name);
        self::assertSame(UserRole::User, $users[0]->role);
        self::assertSame(User::hashToken($token), $users[0]->tokenHash);
        self::assertNotSame($token, $users[0]->tokenHash);
        self::assertNull($users[0]->revokedAt);
    }

    public function testCreateWithAdminOptionAndUniqueTokens(): void
    {
        $first = $this->execute('app:user:create', ['name' => 'Alexander', '--admin' => true]);
        $second = $this->execute('app:user:create', ['name' => 'Jonas']);

        $users = $this->users();
        usort($users, static fn (User $a, User $b) => $a->name <=> $b->name);
        self::assertSame(UserRole::Admin, $users[0]->role);
        self::assertSame(UserRole::User, $users[1]->role);
        self::assertNotSame($first->getDisplay(), $second->getDisplay());
        self::assertNotSame($users[0]->tokenHash, $users[1]->tokenHash);
    }

    public function testCodesUseOnlyTheCodeAlphabet(): void
    {
        $codes = '';
        foreach (range(1, 20) as $i) {
            $code = $this->code($this->execute('app:user:create', ['name' => "User $i"])->getDisplay());
            self::assertSame(14, \strlen($code));
            $codes .= str_replace('-', '', $code);
        }
        self::assertSame('', trim($codes, User::CODE_ALPHABET));
        self::assertCount(20, array_unique(array_column($this->em->getConnection()->fetchAllAssociative('SELECT token_hash FROM users'), 'token_hash')));
    }

    public function testNormalizeTokenIgnoresCaseHyphensSpacesAndLookAlikes(): void
    {
        foreach (['K7QM-4XHT-9RD0', 'k7qm-4xht-9rd0', 'K7QM4XHT9RD0', ' k7qm 4xht 9rdo ', 'K7QM-4XHT-9RDO'] as $input) {
            self::assertSame('K7QM4XHT9RD0', User::normalizeToken($input), $input);
        }
        self::assertSame('1111AAAABBBB', User::normalizeToken('iIlL-aaaa-bbbb'));
    }

    public function testCreateRejectsAnEmptyName(): void
    {
        $tester = $this->execute('app:user:create', ['name' => '   ']);

        self::assertSame(Command::FAILURE, $tester->getStatusCode());
        self::assertStringContainsString('must not be empty', $tester->getDisplay());
        self::assertSame([], $this->users());
    }

    public function testListShowsUsersButNeverTokenOrHash(): void
    {
        $token = 'a-token-that-must-not-appear';
        $active = new User('Kerstin', UserRole::User, User::hashToken($token));
        $revoked = new User('Jonas', UserRole::Admin, User::hashToken('another-token'));
        $revoked->revokedAt = new \DateTimeImmutable();
        $this->em->persist($active);
        $this->em->persist($revoked);
        $this->em->flush();

        $display = $this->execute('app:user:list', [])->getDisplay();

        self::assertStringContainsString('Kerstin', $display);
        self::assertStringContainsString($active->id->toRfc4122(), $display);
        self::assertStringContainsString('admin', $display);
        self::assertStringContainsString('yes', $display);
        self::assertStringNotContainsString($token, $display);
        self::assertStringNotContainsString($active->tokenHash, $display);
        self::assertStringNotContainsString($revoked->tokenHash, $display);
    }

    public function testRevokeSetsRevokedAtAndKeepsTheFirstTimeOnRepeat(): void
    {
        $user = new User('Kerstin', UserRole::User, User::hashToken('t'));
        $this->em->persist($user);
        $this->em->flush();
        $id = $user->id->toRfc4122();

        $tester = $this->execute('app:user:revoke', ['id' => $id]);
        self::assertSame(Command::SUCCESS, $tester->getStatusCode());
        $first = $this->users()[0]->revokedAt;
        self::assertNotNull($first);

        $tester = $this->execute('app:user:revoke', ['id' => $id]);
        self::assertSame(Command::SUCCESS, $tester->getStatusCode());
        self::assertStringContainsString('already revoked', $tester->getDisplay());
        self::assertEquals($first, $this->users()[0]->revokedAt);
    }

    public function testRevokeReportsAnUnknownOrMalformedId(): void
    {
        foreach ([Uuid::v7()->toRfc4122(), 'nope'] as $id) {
            $tester = $this->execute('app:user:revoke', ['id' => $id]);

            self::assertSame(Command::FAILURE, $tester->getStatusCode(), $id);
            self::assertStringContainsString('No user with ID', $tester->getDisplay());
        }
    }
}
