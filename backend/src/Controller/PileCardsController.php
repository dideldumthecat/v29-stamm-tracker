<?php

namespace App\Controller;

use App\KeyFigures\PileCards;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/** PileCardsResponse in frontend/admin/src/api/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class PileCardsController extends AbstractController
{
    #[Route('/api/admin/pile-cards', methods: ['GET'])]
    public function __invoke(PileCards $cards): JsonResponse
    {
        return $this->json($cards->build());
    }
}
