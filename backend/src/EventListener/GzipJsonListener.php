<?php

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Event\ResponseEvent;

/**
 * Compresses JSON responses. On IONOS, Apache's mod_deflate does not reach responses from PHP (verified 6 Nov 2026),
 * so the .htaccess leaves JSON to this listener. Under DDEV Apache skips responses that already have a Content-Encoding.
 * Photos are BinaryFileResponses (JPEG, compressed already) and stay untouched like any file or streamed response.
 */
#[AsEventListener(priority: -100)]
final class GzipJsonListener
{
    public function __invoke(ResponseEvent $event): void
    {
        $response = $event->getResponse();
        if (!$event->isMainRequest()
            || $response instanceof BinaryFileResponse
            || $response instanceof StreamedResponse
            || $response->headers->has('Content-Encoding')
            || !str_starts_with((string) $response->headers->get('Content-Type'), 'application/json')
        ) {
            return;
        }

        // The body depends on the request header, whether or not this request is compressed.
        $response->setVary('Accept-Encoding', false);

        $content = $response->getContent();
        if ('' === $content || false === $content || !str_contains((string) $event->getRequest()->headers->get('Accept-Encoding'), 'gzip')) {
            return;
        }

        $response->setContent(gzencode($content));
        $response->headers->set('Content-Encoding', 'gzip');
        $response->headers->set('Content-Length', (string) \strlen($response->getContent()));
    }
}
