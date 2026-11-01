<?php

namespace App\EventListener;

use App\Entity\User;
use Monolog\Attribute\WithMonologChannel;
use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpKernel\Event\TerminateEvent;

/**
 * One line per /api request, written after the response, so it also covers errors and answers Symfony produces itself.
 * Own channel: prod.log leaves out Symfony's "request" channel below notice (see monolog.yaml), where the router logs "Matched route".
 * Deliberately left out: IP address, cookies, query string, request and response bodies.
 */
#[AsEventListener]
#[WithMonologChannel('api_request')]
final class RequestLogListener
{
    public function __construct(private readonly LoggerInterface $logger)
    {
    }

    public function __invoke(TerminateEvent $event): void
    {
        $request = $event->getRequest();
        $response = $event->getResponse();
        $path = $request->getPathInfo();
        if (!str_starts_with($path, '/api/')) {
            return;
        }

        $user = $request->attributes->get('user');
        $duration = (int) round((microtime(true) - (float) $request->server->get('REQUEST_TIME_FLOAT', microtime(true))) * 1000);
        $this->logger->info(\sprintf('%s %s %d (%d ms)', $request->getMethod(), $path, $response->getStatusCode(), $duration), [
            'method' => $request->getMethod(),
            'path' => $path,
            'status' => $response->getStatusCode(),
            'duration_ms' => $duration,
            'request_bytes' => $request->headers->has('Content-Length') ? (int) $request->headers->get('Content-Length') : null,
            'response_bytes' => $response->headers->has('Content-Length') ? (int) $response->headers->get('Content-Length')
                : ($response instanceof BinaryFileResponse ? $response->getFile()->getSize() : (false === $response->getContent() ? null : \strlen($response->getContent()))),
            'user_id' => $user instanceof User ? $user->id->toRfc4122() : null,
            'user_name' => $user instanceof User ? $user->name : null,
            'user_agent' => mb_substr((string) $request->headers->get('User-Agent'), 0, 120),
            'app_build' => $request->headers->get('X-App-Build'),
        ]);
    }
}
