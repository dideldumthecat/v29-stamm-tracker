<?php

namespace App\Tests\Controller;

use App\Controller\SessionController;
use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Monolog\Handler\TestHandler;
use Monolog\LogRecord;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\BrowserKit\Cookie;

/**
 * The fixture in frontend/src/api/fixtures is the expectation for a valid report.
 */
class DiagnosticsTest extends WebTestCase
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
        $container->get('monolog.logger.client')->pushHandler($this->log);
        $this->client->getCookieJar()->set(new Cookie(SessionController::COOKIE, self::TOKEN));
    }

    private static function fixture(): array
    {
        return json_decode(file_get_contents(__DIR__.'/../../../frontend/src/api/fixtures/diagnostics-request.json'), true, flags: \JSON_THROW_ON_ERROR);
    }

    private function report(array $body, string $build = 'abc1234 2026-10-31T10:00'): void
    {
        $this->client->jsonRequest('POST', '/api/diagnostics', $body, ['HTTP_X_APP_BUILD' => $build]);
    }

    private function entry(array $override = []): array
    {
        return $override + self::fixture()['entries'][1];
    }

    /** @return LogRecord[] */
    private function lines(): array
    {
        return array_values(array_filter($this->log->getRecords(), static fn (LogRecord $record) => 'client' === $record->channel));
    }

    public function testAValidReportWritesOneClientLinePerEntryWithUserAndBuild(): void
    {
        $this->report(self::fixture());

        self::assertResponseStatusCodeSame(204);
        $lines = $this->lines();
        self::assertSame(['ERROR', 'INFO'], array_map(static fn (LogRecord $record) => $record->level->getName(), $lines));
        self::assertSame('Photo 5f3c0b9e upload failed (400)', $lines[0]->message);
        self::assertSame([
            'status' => 400, 'duration_ms' => 18120, 'bytes' => 3830470, 'attempt' => 1, 'blob_source' => 'stored',
            'body_start' => '<!DOCTYPE html><html><head><title>400 Bad Request</title>', 'route' => '/sync', 'online' => true, 'visible' => true,
            'kind' => 'photo_upload', 'entry_id' => '0b6f4c1e-5d0a-4a52-8f43-6d1c2b9e7a10', 'count' => 3, 'device_time' => '2026-10-31T12:27:06.000Z',
            'user_name' => 'Kerstin', 'app_build' => 'abc1234 2026-10-31T10:00', 'user_agent' => self::fixture()['user_agent'],
        ], $lines[0]->context);
        self::assertSame('Kerstin', $lines[1]->context['user_name']);
    }

    public function testAnEmptyReportIsFine(): void
    {
        $this->report(['user_agent' => 'x', 'entries' => []]);

        self::assertResponseStatusCodeSame(204);
        self::assertSame([], $this->lines());
    }

    public function testWithoutSignInIsUnauthorizedAndLogsNothing(): void
    {
        $this->client->getCookieJar()->clear();
        $this->report(self::fixture());

        self::assertResponseStatusCodeSame(401);
        self::assertSame([], $this->lines());
    }

    public function testMoreThan100EntriesAreRejected(): void
    {
        $this->report(['user_agent' => 'x', 'entries' => array_fill(0, 101, $this->entry())]);
        self::assertResponseStatusCodeSame(413);
        self::assertSame([], $this->lines());

        $this->report(['user_agent' => 'x', 'entries' => array_fill(0, 100, $this->entry())]);
        self::assertResponseStatusCodeSame(204);
        self::assertCount(100, $this->lines());
    }

    public function testMoreThan256KilobytesAreRejected(): void
    {
        $this->report(['user_agent' => 'x', 'entries' => [$this->entry(['message' => str_repeat('x', 256 * 1024)])]]);

        self::assertResponseStatusCodeSame(413);
        self::assertSame([], $this->lines());
    }

    public function testLongStringsAreTruncated(): void
    {
        $this->report(['user_agent' => str_repeat('u', 900), 'entries' => [$this->entry([
            'message' => str_repeat('m', 5000),
            'context' => ['body_start' => str_repeat('ä', 900), 'status' => 400],
        ])]]);

        self::assertResponseStatusCodeSame(204);
        $line = $this->lines()[0];
        self::assertSame(1000, mb_strlen($line->message));
        self::assertSame(500, mb_strlen($line->context['body_start']));
        self::assertSame(500, mb_strlen($line->context['user_agent']));
        self::assertSame(400, $line->context['status']);
    }

    public function testTheDeviceCannotOverwriteTheServersFields(): void
    {
        $this->report(['user_agent' => 'x', 'entries' => [$this->entry(['context' => ['user_name' => 'Mallory', 'app_build' => 'fake']])]]);

        self::assertSame(['Kerstin', 'abc1234 2026-10-31T10:00'], [$this->lines()[0]->context['user_name'], $this->lines()[0]->context['app_build']]);
    }

    /**
     * @return iterable<string, array{array}>
     */
    public static function malformedEntries(): iterable
    {
        yield 'nested context' => [['context' => ['route' => ['/sync']]]];
        yield 'context is a string' => [['context' => 'x']];
        yield 'unknown level' => [['level' => 'debug']];
        yield 'id is no UUID' => [['id' => 'abc']];
        yield 'at is no timestamp' => [['at' => 'yesterday']];
        yield 'count below 1' => [['count' => 0]];
        yield 'empty kind' => [['kind' => '']];
        yield 'message is a number' => [['message' => 5]];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('malformedEntries')]
    public function testMalformedEntriesAreBadRequestsAndLogNothing(array $override): void
    {
        $this->report(['user_agent' => 'x', 'entries' => [$this->entry(), $this->entry($override)]]);

        self::assertResponseStatusCodeSame(400);
        self::assertSame([], $this->lines());
    }

    public function testMalformedBodiesAreBadRequests(): void
    {
        foreach ([['entries' => []], ['user_agent' => 'x'], ['user_agent' => 'x', 'entries' => ['a' => 1]], ['user_agent' => 1, 'entries' => []]] as $body) {
            $this->report($body);
            self::assertResponseStatusCodeSame(400);
        }
        $this->client->request('POST', '/api/diagnostics', content: 'not json');
        self::assertResponseStatusCodeSame(400);
    }

    public function testNeitherTheInviteCodeNorTheCookieEndsUpInTheLines(): void
    {
        $this->report(self::fixture());

        $all = json_encode(array_map(static fn (LogRecord $record) => $record->toArray(), $this->log->getRecords()));
        self::assertStringNotContainsString(self::TOKEN, $all);
        self::assertStringNotContainsString(SessionController::COOKIE, $all);
    }
}
