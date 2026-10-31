<?php

namespace App\Controller;

use App\Api\Timestamp;
use App\Entity\User;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/**
 * DiagnosticsRequest in frontend/src/api/contract.ts. The reports of the app go to the Monolog channel "client"
 * (its own file in production), one line per entry, nothing to the database.
 */
final class DiagnosticsController extends AbstractController
{
    private const MAX_ENTRIES = 100;
    private const MAX_BYTES = 256 * 1024;
    private const LEVELS = ['error', 'warning', 'info'];
    private const MAX_MESSAGE = 1000;
    private const MAX_STRING = 500;

    public function __construct(#[Autowire(service: 'monolog.logger.client')] private readonly LoggerInterface $logger)
    {
    }

    #[Route('/api/diagnostics', methods: ['POST'])]
    public function __invoke(Request $request, User $user): Response
    {
        if (\strlen($request->getContent()) > self::MAX_BYTES) {
            throw new HttpException(413, 'A report may be 256 KB at most.');
        }
        $body = $request->toArray();
        $entries = $body['entries'] ?? null;
        if (!\is_string($body['user_agent'] ?? null) || !\is_array($entries) || !array_is_list($entries)) {
            throw new BadRequestHttpException('user_agent must be a string and entries a list.');
        }
        if (\count($entries) > self::MAX_ENTRIES) {
            throw new HttpException(413, 'A report may hold 100 entries at most.');
        }

        // Everything is checked before the first line is written: a malformed request logs nothing.
        $lines = [];
        foreach ($entries as $index => $entry) {
            $lines[] = $this->parse($entry, $index);
        }

        $userAgent = mb_substr($body['user_agent'], 0, self::MAX_STRING);
        $appBuild = $request->headers->get('X-App-Build');
        foreach ($lines as [$level, $message, $context]) {
            // The server's own fields come last: the device cannot overwrite them.
            $this->logger->log($level, $message, [...$context, 'user_name' => $user->name, 'app_build' => $appBuild, 'user_agent' => $userAgent]);
        }

        return new Response(status: Response::HTTP_NO_CONTENT);
    }

    /**
     * @return array{string, string, array<string, mixed>} level, message and the context to log
     */
    private function parse(mixed $entry, int $index): array
    {
        $fail = static fn (string $problem) => new BadRequestHttpException(\sprintf('entries[%d]: %s', $index, $problem));
        if (!\is_array($entry)) {
            throw $fail('not an object.');
        }
        $id = \is_string($entry['id'] ?? null) && Uuid::isValid($entry['id']) ? $entry['id'] : throw $fail('id must be a UUID.');
        $at = Timestamp::parse($entry['at'] ?? null) ?? throw $fail('at must be an ISO 8601 timestamp.');
        $level = \in_array($entry['level'] ?? null, self::LEVELS, true) ? $entry['level'] : throw $fail('level must be error, warning or info.');
        $kind = \is_string($entry['kind'] ?? null) && '' !== $entry['kind'] ? $entry['kind'] : throw $fail('kind must be a non-empty string.');
        $message = \is_string($entry['message'] ?? null) ? $entry['message'] : throw $fail('message must be a string.');
        $count = \is_int($entry['count'] ?? null) && $entry['count'] >= 1 ? $entry['count'] : throw $fail('count must be an integer of at least 1.');
        $fields = $entry['context'] ?? null;
        if (!\is_array($fields)) {
            throw $fail('context must be an object.');
        }

        $context = [];
        foreach ($fields as $key => $value) {
            if (null !== $value && !\is_scalar($value)) {
                throw $fail('context holds flat scalar values only.');
            }
            $context[mb_substr((string) $key, 0, 50)] = \is_string($value) ? mb_substr($value, 0, self::MAX_STRING) : $value;
        }

        return [$level, mb_substr($message, 0, self::MAX_MESSAGE), [
            ...$context,
            'kind' => mb_substr($kind, 0, 50),
            'entry_id' => $id,
            'count' => $count,
            'device_time' => Timestamp::format($at),
        ]];
    }
}
