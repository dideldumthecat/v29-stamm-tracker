<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Monolog\Handler\TestHandler;
use Monolog\Level;
use Monolog\LogRecord;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Yaml\Yaml;

class RequestLogTest extends WebTestCase
{
    private const TOKEN = 'Kerstin-test-token';

    private KernelBrowser $client;
    private TestHandler $log;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = self::getContainer();
        $container->get(EntityManagerInterface::class)->persist(new User('Kerstin', UserRole::User, User::hashToken(User::normalizeToken(self::TOKEN))));
        $container->get(EntityManagerInterface::class)->flush();

        $this->log = new TestHandler();
        $container->get('monolog.logger.request')->pushHandler($this->log);
        $container->get('logger')->pushHandler($this->log);
    }

    private function signIn(): void
    {
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, self::TOKEN));
    }

    private function requestLines(): array
    {
        return array_values(array_filter($this->log->getRecords(), static fn (LogRecord $record) => isset($record->context['duration_ms'])));
    }

    private static function event(string $type, string $itemId, array $data): array
    {
        return ['id' => Uuid::v4()->toRfc4122(), 'schema_version' => 1, 'type' => $type, 'timber_item_id' => $itemId, 'data' => $data, 'recorded_at' => '2026-10-02T07:12:00.000Z'];
    }

    public function testPingProducesOneRequestLine(): void
    {
        $this->client->request('GET', '/api/ping?secret=1', server: ['HTTP_USER_AGENT' => str_repeat('x', 300), 'HTTP_X_APP_BUILD' => 'abc1234 2026-10-31T10:00']);

        $lines = $this->requestLines();
        self::assertCount(1, $lines);
        $context = $lines[0]->context;
        self::assertSame('request', $lines[0]->channel);
        self::assertSame(['method' => 'GET', 'path' => '/api/ping', 'status' => 200, 'user_id' => null, 'user_name' => null, 'app_build' => 'abc1234 2026-10-31T10:00'],
            array_intersect_key($context, array_flip(['method', 'path', 'status', 'user_id', 'user_name', 'app_build'])));
        self::assertSame(120, mb_strlen($context['user_agent']));
        self::assertIsInt($context['duration_ms']);
        self::assertGreaterThan(0, $context['response_bytes']);
        self::assertArrayHasKey('request_bytes', $context);
        self::assertStringNotContainsString('secret', json_encode($lines[0]->toArray()));
    }

    public function testSyncProducesOneRequestLineWithTheUserAndADomainLine(): void
    {
        $this->signIn();
        $item = Uuid::v4()->toRfc4122();
        $created = self::event('created', $item, ['parent_id' => null]);
        $this->client->jsonRequest('POST', '/api/sync', ['events' => [$created]]);
        // BrowserKit sends no Content-Length like a real client does.
        $this->client->jsonRequest('POST', '/api/sync', ['events' => [$created, self::event('tag_assigned', $item, ['tag_number' => '7'])]], ['CONTENT_LENGTH' => '1234']);

        $lines = $this->requestLines();
        self::assertCount(2, $lines);
        self::assertSame('Kerstin', $lines[1]->context['user_name']);
        self::assertSame(['POST', '/api/sync', 200], [$lines[1]->context['method'], $lines[1]->context['path'], $lines[1]->context['status']]);
        self::assertSame('1234', $lines[1]->context['request_bytes']);

        $domain = array_values(array_filter($this->log->getRecords(), static fn (LogRecord $record) => 'app' === $record->channel));
        self::assertStringContainsString('2 received, 1 new, 1 known, 0 rejected', $domain[1]->message);
        self::assertSame(['received' => 2, 'new' => 1, 'known' => 1, 'rejected' => []], $domain[1]->context);
    }

    public function testASignInLogsNeitherTheInviteCodeNorACookie(): void
    {
        $this->client->jsonRequest('POST', '/api/session', ['token' => self::TOKEN]);
        self::assertResponseIsSuccessful();
        self::assertNotNull($this->client->getResponse()->headers->getCookies()[0] ?? null);

        $lines = $this->requestLines();
        self::assertCount(1, $lines);
        self::assertSame('Kerstin', $lines[0]->context['user_name']);
        $all = json_encode(array_map(static fn (LogRecord $record) => $record->toArray(), $this->log->getRecords()));
        self::assertStringNotContainsString(self::TOKEN, $all);
        self::assertStringNotContainsString(SessionController::COOKIE, $all);
        self::assertStringNotContainsString('127.0.0.1', $all);
    }

    public function testSnapshotIsLoggedAsADomainLine(): void
    {
        $this->signIn();
        $this->client->request('GET', '/api/snapshot');

        $domain = array_values(array_filter($this->log->getRecords(), static fn (LogRecord $record) => 'app' === $record->channel));
        self::assertCount(1, $domain);
        self::assertSame('Snapshot delivered: 0 timber items', $domain[0]->message);
    }

    public function testAFailingRequestLogsItsRequestLineAndTheErrorOnTheSameChannel(): void
    {
        $this->client->request('GET', '/api/snapshot');

        self::assertResponseStatusCodeSame(401);
        // Symfony's own "Matched route" line (info) is expected alongside, but not part of the claim.
        $records = array_values(array_filter($this->log->getRecords(), static fn (LogRecord $record) => !str_starts_with($record->message, 'Matched route')));
        self::assertSame(['ERROR', 'INFO'], array_map(static fn (LogRecord $record) => $record->level->getName(), $records));
        self::assertSame(['request', 'request'], array_map(static fn (LogRecord $record) => $record->channel, $records));
        self::assertSame(401, $records[1]->context['status']);
    }

    public function testUnknownPathsAndWrongMethodsAreNoticesButBadRequestsStayErrors(): void
    {
        $this->signIn();
        $this->client->request('GET', '/api/nothing');
        self::assertResponseStatusCodeSame(404);
        $this->client->request('GET', '/api/sync');
        self::assertResponseStatusCodeSame(405);
        self::assertSame([], array_filter($this->log->getRecords(), static fn (LogRecord $record) => $record->level->value >= Level::Error->value));
        self::assertTrue($this->log->hasNoticeThatContains('Uncaught PHP Exception'));
        self::assertSame([404, 405], array_map(static fn (LogRecord $record) => $record->context['status'], $this->requestLines()));

        $this->client->jsonRequest('POST', '/api/sync', ['events' => 'no list']);
        self::assertResponseStatusCodeSame(400);
        $this->client->getCookieJar()->clear();
        $this->client->request('GET', '/api/snapshot');
        self::assertResponseStatusCodeSame(401);
        self::assertCount(2, array_filter($this->log->getRecords(), static fn (LogRecord $record) => Level::Error === $record->level && str_starts_with($record->message, 'Uncaught PHP Exception')));
    }

    /** Production writes everything but the app's own reports to prod.log; the test environment cannot show that, so the configuration is checked. */
    public function testProductionLogsEverythingInfoAndAboveToOneRotatingFile(): void
    {
        $handlers = Yaml::parseFile(__DIR__.'/../../config/packages/monolog.yaml')['when@prod']['monolog']['handlers'];

        self::assertSame(['main', 'client', 'console'], array_keys($handlers));
        self::assertSame(
            ['type' => 'rotating_file', 'path' => '%kernel.logs_dir%/%kernel.environment%.log', 'level' => 'info', 'max_files' => 30, 'channels' => ['!event', '!doctrine', '!deprecation', '!client']],
            $handlers['main'],
        );
        self::assertSame(
            ['type' => 'rotating_file', 'path' => '%kernel.logs_dir%/client.log', 'level' => 'info', 'max_files' => 30, 'channels' => ['client'], 'formatter' => 'monolog.formatter.json'],
            $handlers['client'],
        );
    }

    public function testRequestsOutsideTheApiAreNotLogged(): void
    {
        $this->client->request('GET', '/something-else');

        self::assertSame([], $this->requestLines());
    }
}
