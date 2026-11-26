<?php

namespace App\Controller;

use App\KeyFigures\Dashboard;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/** DashboardResponse in frontend/admin/src/api/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class DashboardController extends AbstractController
{
    #[Route('/api/admin/dashboard', methods: ['GET'])]
    public function __invoke(Dashboard $dashboard): JsonResponse
    {
        return $this->json($dashboard->build());
    }
}
