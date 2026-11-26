<?php

namespace App\Controller;

use App\Entity\User;
use App\Sync\InvalidSync;
use App\Sync\SyncProcessor;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;

/**
 * SyncRequest → SyncResponse in frontend/shared/contract.ts.
 * Not #[MapRequestPayload]: it answers 422 where the contract says 400, and the events are checked against the
 * database (known attributes, parents, tags), not only against a shape.
 */
final class SyncController extends AbstractController
{
    use JsonBody;

    public function __construct(private readonly SyncProcessor $sync)
    {
    }

    #[Route('/api/sync', methods: ['POST'])]
    public function __invoke(Request $request, User $user): JsonResponse
    {
        try {
            return $this->json($this->sync->process($user, $this->body($request)));
        } catch (InvalidSync $e) {
            throw new BadRequestHttpException($e->getMessage(), $e);
        }
    }
}
