<?php

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

#[AsCommand(name: 'app:user:revoke', description: 'Revoke a user\'s invite link (their recorded events stay)')]
class UserRevokeCommand
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'User ID, see app:user:list')] string $id,
    ): int {
        $user = Uuid::isValid($id) ? $this->em->find(User::class, Uuid::fromString($id)) : null;
        if (!$user) {
            $io->error(\sprintf('No user with ID "%s".', $id));

            return Command::FAILURE;
        }
        if ($user->revokedAt) {
            // Keep the original time; revoking twice is not an error.
            $io->note(\sprintf('"%s" was already revoked on %s UTC.', $user->name, $user->revokedAt->format('Y-m-d H:i')));

            return Command::SUCCESS;
        }

        $user->revokedAt = new \DateTimeImmutable();
        $this->em->flush();
        $io->success(\sprintf('Revoked "%s".', $user->name));

        return Command::SUCCESS;
    }
}
