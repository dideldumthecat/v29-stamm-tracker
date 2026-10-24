<?php

namespace App\EventListener;

use App\Controller\SessionController;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Every /api endpoint except ping and session needs the token cookie. The user lands in the request
 * attribute "user", so a controller gets it simply as a `User $user` argument.
 */
#[AsEventListener]
final class AuthenticateListener
{
    private const PUBLIC_PATHS = ['/api/ping', '/api/session'];

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    public function __invoke(RequestEvent $event): void
    {
        $request = $event->getRequest();
        $path = $request->getPathInfo();
        if (!$event->isMainRequest() || !str_starts_with($path, '/api/') || \in_array($path, self::PUBLIC_PATHS, true)) {
            return;
        }

        $token = $request->cookies->getString(SessionController::COOKIE);
        $user = '' === $token ? null : $this->em->getRepository(User::class)
            ->findOneBy(['tokenHash' => User::hashToken($token), 'revokedAt' => null]);
        if (!$user) {
            throw new HttpException(401, 'Unknown or revoked invite link.');
        }
        $request->attributes->set('user', $user);
    }
}
