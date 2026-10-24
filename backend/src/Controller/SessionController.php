<?php

namespace App\Controller;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\Routing\Attribute\Route;

final class SessionController extends AbstractController
{
    public const COOKIE = 'v29_token';

    #[Route('/api/session', methods: ['POST'])]
    public function __invoke(Request $request, EntityManagerInterface $em): JsonResponse
    {
        $token = $request->toArray()['token'] ?? null;
        if (!\is_string($token) || '' === $token) {
            throw new BadRequestHttpException('token must be a non-empty string.');
        }
        $user = $em->getRepository(User::class)->findOneBy(['tokenHash' => User::hashToken($token), 'revokedAt' => null]);
        if (!$user) {
            throw new HttpException(401, 'Unknown or revoked invite link.');
        }

        $response = $this->json(['user' => ['id' => $user->id->toRfc4122(), 'name' => $user->name]]);
        // The token itself, no PHP session: session garbage collection on shared hosting would log people out
        // in the forest. Revoking the user ends access, since every request checks the token again.
        $response->headers->setCookie(Cookie::create(self::COOKIE, $token)
            ->withExpires(new \DateTimeImmutable('+5 years'))
            ->withPath('/api')
            ->withSecure()
            ->withHttpOnly()
            ->withSameSite(Cookie::SAMESITE_STRICT));

        return $response;
    }
}
