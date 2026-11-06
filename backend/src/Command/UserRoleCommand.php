<?php

namespace App\Command;

use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:user:role', description: 'Change the role of an active user (user, admin or superadmin; at most one superadmin)')]
class UserRoleCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly Superadmin $superadmin,
        private readonly UserLookup $lookup,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Name or ID of an active user, see app:user:list')] string $user,
        #[Argument(description: 'user, admin or superadmin')] string $role,
    ): int {
        $newRole = UserRole::tryFrom($role);
        $target = $this->lookup->find($user, activeOnly: true);
        $error = match (true) {
            null === $newRole => \sprintf('"%s" is not a role. Use user, admin or superadmin.', $role),
            \is_string($target) => $target,
            UserRole::Superadmin === $newRole => $this->superadmin->conflict($target),
            default => null,
        };
        if (null !== $error) {
            $io->error($error);

            return Command::FAILURE;
        }

        $target->role = $newRole;
        $this->em->flush();
        $io->success(\sprintf('"%s" (%s) is now %s.', $target->name, $target->id->toRfc4122(), $newRole->value));

        return Command::SUCCESS;
    }
}
