<?php

namespace App\Controller;

use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

final class PingController extends AbstractController
{
    #[Route('/api/ping', methods: ['GET'])]
    public function __invoke(Connection $db): JsonResponse
    {
        return $this->json(['ok' => true, 'db' => $db->fetchOne('SELECT VERSION()')]);
    }
}
