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
    /** @var array<string, TestHandler> the prod handlers that write to prod.log, by name */
    private array $prodFile = [];

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = self::getContainer();
        $container->get(EntityManagerInterface::class)->persist(new User('Kerstin', UserRole::User, User::hashToken(User::normalizeToken(self::TOKEN))));
        $container->get(EntityManagerInterface::class)->flush();

        $this->log = new TestHandler();
        foreach (['request', 'api_request'] as $channel) {
            $container->get('monolog.logger.'.$channel)->pushHandler($this->log);
        }
        $container->get('logger')->pushHandler($this->log);
        $this->wireProdFileHandlers();
    }

    /**
     * The test environment writes nowhere, so the real prod handlers (level, channel filter) are rebuilt from
     * monolog.yaml as TestHandlers: what they collect is what would end up in prod.log.
     */
    private function wireProdFileHandlers(): void
    {
        $handlers = Yaml::parseFile(__DIR__.'/../../config/packages/monolog.yaml')['when@prod']['monolog']['handlers'];
        $channels = ['app' => 'logger', 'request' => 'monolog.logger.request', 'api_request' => 'monolog.logger.api_request'];
        foreach (['main', 'request_problems'] as $name) {
            $handler = new TestHandler(Level::fromName($handlers[$name]['level']));
            $this->prodFile[$name] = $handler;
            $listed = $handlers[$name]['channels'];
            $excluding = str_starts_with($listed[0], '!');
            foreach ($channels as $channel => $service) {
                $included = $excluding ? !\in_array('!'.$channel, $listed, true) : \in_array($channel, $listed, true);
                if ($included) {
                    self::getContainer()->get($service)->pushHandler($handler);
                }
            }
        }
    }

    /** @return list<LogRecord> */
    private function prodLogLines(): array
    {
        $records = array_merge(...array_values(array_map(static fn (TestHandler $handler) => $handler->getRecords(), $this->prodFile)));
        usort($records, static fn (LogRecord $a, LogRecord $b) => $a->datetime <=> $b->datetime);

        return $records;
    }

    private function signIn(): void
    {
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, self::TOKEN));
    }

    /** @return list<LogRecord> */
    private function requestLines(): array
    {
        return array_values(array_filter($this->log->getRecords(), static fn (LogRecord $record) => isset($record->context['duration_ms'])));
    }

    /**
     * @param array<string, mixed> $data
     *
     * @return array<string, mixed>
     */
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
        self::assertSame('api_request', $lines[0]->channel);
        self::assertSame(['method' => 'GET', 'path' => '/api/ping', 'status' => 200, 'user_id' => null, 'user_name' => null, 'app_build' => 'abc1234 2026-10-31T10:00'],
            array_intersect_key($context, array_flip(['method', 'path', 'status', 'user_id', 'user_name', 'app_build'])));
        self::assertSame(120, mb_strlen($context['user_agent']));
        self::assertIsInt($context['duration_ms']);
        self::assertGreaterThan(0, $context['response_bytes']);
        self::assertNull($context['request_bytes']);
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
        self::assertSame(1234, $lines[1]->context['request_bytes']);

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
        $records = $this->prodLogLines();
        self::assertSame(['ERROR', 'INFO'], array_map(static fn (LogRecord $record) => $record->level->getName(), $records));
        self::assertSame(['request', 'api_request'], array_map(static fn (LogRecord $record) => $record->channel, $records));
        self::assertStringContainsString('Uncaught PHP Exception', $records[0]->message);
        self::assertArrayHasKey('exception', $records[0]->context);
        self::assertSame(401, $records[1]->context['status']);
    }

    public function testANormalRequestAddsExactlyOneLineToProdLog(): void
    {
        $this->client->request('GET', '/api/ping');

        // The router's "Matched route" is logged (here, as in dev), but does not reach prod.log.
        self::assertTrue($this->log->hasInfoThatContains('Matched route'));
        $lines = $this->prodLogLines();
        self::assertCount(1, $lines);
        self::assertSame('GET /api/ping 200', substr($lines[0]->message, 0, 17));
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
        // Both reach prod.log: the notice from the "request" channel and the request line.
        self::assertSame(['NOTICE', 'INFO', 'NOTICE', 'INFO'], array_map(static fn (LogRecord $record) => $record->level->getName(), $this->prodLogLines()));
        self::assertSame([404, 405], array_map(static fn (LogRecord $record) => $record->context['status'], $this->requestLines()));

        $this->client->jsonRequest('POST', '/api/sync', ['events' => 'no list']);
        self::assertResponseStatusCodeSame(400);
        $this->client->getCookieJar()->clear();
        $this->client->request('GET', '/api/snapshot');
        self::assertResponseStatusCodeSame(401);
        self::assertCount(2, array_filter($this->log->getRecords(), static fn (LogRecord $record) => Level::Error === $record->level && str_starts_with($record->message, 'Uncaught PHP Exception')));
    }

    /** The prod.log handlers that wireProdFileHandlers() rebuilds, and the app's own reports in a file of their own. */
    public function testProductionLogsEverythingInfoAndAboveToOneRotatingFile(): void
    {
        $handlers = Yaml::parseFile(__DIR__.'/../../config/packages/monolog.yaml')['when@prod']['monolog']['handlers'];

        self::assertSame(['main', 'request_problems', 'client', 'console'], array_keys($handlers));
        self::assertSame(
            ['type' => 'rotating_file', 'path' => '%kernel.logs_dir%/%kernel.environment%.log', 'level' => 'info', 'max_files' => 30, 'channels' => ['!event', '!doctrine', '!deprecation', '!client', '!request']],
            $handlers['main'],
        );
        self::assertSame(
            ['type' => 'rotating_file', 'path' => '%kernel.logs_dir%/%kernel.environment%.log', 'level' => 'notice', 'max_files' => 30, 'channels' => ['request']],
            $handlers['request_problems'],
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
