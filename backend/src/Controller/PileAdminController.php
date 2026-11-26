<?php

namespace App\Controller;

use App\Attributes\InvalidAttribute;
use App\Pile\PileEditor;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;

/** AdminPilesResponse, AdminPile, AdminPileInput and AttributeErrorsResponse in frontend/admin/src/api/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class PileAdminController extends AbstractController
{
    use JsonBody;

    public function __construct(private readonly PileEditor $piles)
    {
    }

    #[Route('/api/admin/piles', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json(['piles' => $this->piles->all()]);
    }

    #[Route('/api/admin/piles', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        return $this->guard(fn () => $this->json($this->piles->create($this->body($request)), Response::HTTP_CREATED));
    }

    #[Route('/api/admin/piles/{id}', methods: ['PATCH'])]
    public function update(string $id, Request $request): JsonResponse
    {
        $option = $this->piles->find($id) ?? throw new NotFoundHttpException('No such pile.');

        return $this->guard(fn () => $this->json($this->piles->update($option, $this->body($request))));
    }

    /** @param callable(): JsonResponse $action */
    private function guard(callable $action): JsonResponse
    {
        try {
            return $action();
        } catch (InvalidAttribute $e) {
            return $this->json(['errors' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }
}
