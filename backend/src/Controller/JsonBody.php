<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

/** The body of a request of the administration as an array. */
trait JsonBody
{
    /** @return array<mixed> */
    private function body(Request $request): array
    {
        $body = json_decode($request->getContent(), true);
        if (!\is_array($body) || (array_is_list($body) && [] !== $body)) {
            throw new BadRequestHttpException('The body must be a JSON object.');
        }

        return $body;
    }
}
