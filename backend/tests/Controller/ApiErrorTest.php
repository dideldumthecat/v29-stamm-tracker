<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\User;
use App\Entity\UserRole;
use App\Tests\Support\Groups;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Monolog\Handler\TestHandler;
use Monolog\Level;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;

/** Errors under /api come back as JSON; the kernel runs without debug, as in production. */
class ApiErrorTest extends WebTestCase
{
    private const TOKEN = 'Kerstin-test-token';

    private KernelBrowser $client;

    protected function setUp(): void
    {
        $this->client = static::createClient(['debug' => false]);
        $this->client->disableReboot();
    }

    public function testABadRequestIsJson(): void
    {
        $this->signIn();
        $this->client->request('GET', '/api/admin/activity?tags=abc');

        self::assertJsonError(400);
        self::assertSame('', $this->error()['field']);
        self::assertNotSame('', $this->error()['message']);
    }

    public function testAnUnknownPathAndAnUnauthorizedRequestAreJson(): void
    {
        $this->signIn();
        $this->client->request('GET', '/api/nothing');
        self::assertJsonError(404);

        $this->client->getCookieJar()->clear();
        $this->client->request('GET', '/api/snapshot');
        self::assertJsonError(401);
        self::assertSame('Unknown or revoked invite link.', $this->error()['message']);
    }

    public function testAServerErrorShowsNoDetails(): void
    {
        $db = $this->createStub(Connection::class);
        $db->method('fetchOne')->willThrowException(new \RuntimeException('secret detail'));
        self::getContainer()->set(Connection::class, $db);

        $this->client->request('GET', '/api/ping');

        self::assertJsonError(500);
        self::assertSame('Internal Server Error', $this->error()['message']);
        self::assertStringNotContainsString('secret', $this->client->getResponse()->getContent());
    }

    /** The JSON answer hides the exception, so the log must have it, with its stack trace, in debug and in production alike. */
    #[DataProvider('debugModes')]
    public function testAServerErrorIsLoggedWithItsExceptionAndTrace(bool $debug): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient(['debug' => $debug]);
        $this->client->disableReboot();
        $db = $this->createStub(Connection::class);
        $db->method('fetchOne')->willThrowException(new \RuntimeException('secret detail'));
        self::getContainer()->set(Connection::class, $db);
        $log = new TestHandler();
        self::getContainer()->get('monolog.logger.request')->pushHandler($log);

        $this->client->request('GET', '/api/ping');

        self::assertJsonError(500);
        $errors = array_values(array_filter($log->getRecords(), static fn ($record) => $record->level->value >= Level::Error->value));
        self::assertCount(1, $errors);
        $exception = $errors[0]->context['exception'];
        self::assertInstanceOf(\RuntimeException::class, $exception);
        self::assertSame('secret detail', $exception->getMessage());
        self::assertNotSame('', $exception->getTraceAsString());
    }

    /** @return array<string, array{bool}> */
    public static function debugModes(): array
    {
        return ['debug' => [true], 'production' => [false]];
    }

    public function testOtherPathsKeepTheErrorPage(): void
    {
        $this->client->request('GET', '/nothing');

        self::assertResponseStatusCodeSame(404);
        self::assertStringStartsWith('text/html', $this->client->getResponse()->headers->get('Content-Type'));
    }

    private function signIn(): void
    {
        $em = self::getContainer()->get(EntityManagerInterface::class);
        $em->persist(new User('Kerstin', UserRole::Admin, Groups::v29($em), User::hashToken(User::normalizeToken(self::TOKEN))));
        $em->flush();
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, self::TOKEN));
    }

    private function assertJsonError(int $status): void
    {
        self::assertResponseStatusCodeSame($status);
        self::assertResponseHeaderSame('Content-Type', 'application/json');
        self::assertArrayHasKey('message', $this->error());
    }

    /** @return array{field: string, message: string} */
    private function error(): array
    {
        $body = json_decode($this->client->getResponse()->getContent(), true);
        self::assertCount(1, $body['errors']);

        return $body['errors'][0];
    }
}
