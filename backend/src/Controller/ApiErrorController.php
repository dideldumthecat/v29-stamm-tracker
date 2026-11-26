<?php

namespace App\Controller;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\HttpKernel\Controller\ErrorController;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Renders every error under /api as JSON, in the format the controllers use for their own errors (422): `{ errors: [{ field, message }] }`.
 * `field` is empty because the error is not about one field. Registered as framework.error_controller, so Symfony still logs the
 * exception first. A 5xx shows a general text only; the log has the details. Other paths keep Symfony's error page.
 */
#[AsController]
final class ApiErrorController
{
    public function __construct(#[Autowire(service: 'error_controller')] private readonly ErrorController $default)
    {
    }

    public function __invoke(Request $request, \Throwable $exception): Response
    {
        if (!str_starts_with($request->getPathInfo(), '/api/')) {
            return ($this->default)($exception);
        }

        $http = $exception instanceof HttpExceptionInterface;
        $status = $http ? $exception->getStatusCode() : Response::HTTP_INTERNAL_SERVER_ERROR;
        $message = $status < 500 && '' !== $exception->getMessage() ? $exception->getMessage() : (Response::$statusTexts[$status] ?? 'Error');

        return new JsonResponse(['errors' => [['field' => '', 'message' => $message]]], $status, $http ? $exception->getHeaders() : []);
    }
}
