<?php

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:user:list', description: 'List users (never prints tokens or hashes)')]
class UserListCommand
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $users = $this->em->getRepository(User::class)->findBy([], ['createdAt' => 'ASC']);
        $io->table(
            ['Name', 'Role', 'ID', 'Revoked'],
            array_map(
                static fn (User $user) => [
                    $user->name,
                    $user->role->value,
                    $user->id->toRfc4122(),
                    $user->revokedAt ? 'yes ('.$user->revokedAt->format('Y-m-d H:i').' UTC)' : 'no',
                ],
                $users,
            ),
        );

        return Command::SUCCESS;
    }
}
