<?php

namespace App\Controller;

use App\Activity\ActivityLog;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;

/** ActivityResponse in frontend/shared/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class ActivityController extends AbstractController
{
    #[Route('/api/admin/activity', methods: ['GET'])]
    public function __invoke(Request $request, ActivityLog $log): JsonResponse
    {
        $query = static fn (string $name): ?string => '' === ($value = trim($request->query->getString($name))) ? null : $value;

        try {
            return $this->json($log->page($query('from'), $query('to'), $query('user'), $query('tags'), $query('before')));
        } catch (\InvalidArgumentException $e) {
            throw new BadRequestHttpException($e->getMessage(), $e);
        }
    }
}
