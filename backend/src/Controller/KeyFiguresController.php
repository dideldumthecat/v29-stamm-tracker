<?php

namespace App\Controller;

use App\KeyFigures\ItemKeyFigures;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/** KeyFiguresResponse in frontend/shared/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class KeyFiguresController extends AbstractController
{
    #[Route('/api/admin/timber-items/{id}/key-figures', methods: ['GET'])]
    public function __invoke(string $id, ItemKeyFigures $itemKeyFigures): JsonResponse
    {
        $figures = Uuid::isValid($id) ? $itemKeyFigures->of(Uuid::fromString($id)) : null;

        return $figures ? $this->json(['figures' => $figures]) : throw new NotFoundHttpException('No such stem or beam.');
    }
}
