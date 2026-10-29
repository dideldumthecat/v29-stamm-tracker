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
        // Fails if the database is unreachable; the version itself stays private.
        $db->fetchOne('SELECT 1');

        // What the web server's PHP accepts for uploads (the command line may have other values). Public, like the rest of ping.
        return $this->json([
            'ok' => true,
            'upload_max_filesize' => ini_parse_quantity(ini_get('upload_max_filesize') ?: '0'),
            'post_max_size' => ini_parse_quantity(ini_get('post_max_size') ?: '0'),
        ]);
    }
}
