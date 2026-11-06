<?php

namespace App\Controller;

use App\Entity\User;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/** AdminMeResponse in frontend/shared/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class AdminMeController extends AbstractController
{
    #[Route('/api/admin/me', methods: ['GET'])]
    public function __invoke(User $user): JsonResponse
    {
        return $this->json(['user' => ['id' => $user->id->toRfc4122(), 'name' => $user->name, 'role' => $user->role->value]]);
    }
}
