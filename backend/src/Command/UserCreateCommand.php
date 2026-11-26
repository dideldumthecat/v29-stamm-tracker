<?php

namespace App\Command;

use App\Entity\User;
use App\Entity\UserRole;
use App\User\Invites;
use App\User\UserGroups;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:user:create', description: 'Create a user and print their personal invite code')]
class UserCreateCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly Superadmin $superadmin,
        private readonly Invites $invites,
        private readonly UserGroups $groups,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Name shown as "recorded by"')] string $name,
        #[Option(description: 'user, admin (administration) or superadmin (administration; the console commands record under it; at most one)')] string $role = 'user',
    ): int {
        $name = trim($name);
        $userRole = UserRole::tryFrom($role);
        $group = $this->groups->default();
        $error = match (true) {
            '' === $name => 'The name must not be empty.',
            null === $userRole => \sprintf('"%s" is not a role. Use user, admin or superadmin.', $role),
            null === $group => 'There is no user group yet. Create one in the administration first.',
            UserRole::Superadmin === $userRole => $this->superadmin->conflict(),
            default => null,
        };
        if (null !== $error) {
            $io->error($error);

            return Command::FAILURE;
        }

        // Only the hash is stored, never the code itself.
        $user = new User($name, $userRole, $group, '');
        $code = $this->invites->issue($user);
        $this->em->persist($user);
        $this->em->flush();

        $io->success(\sprintf('Created %s "%s" (%s).', $user->role->value, $user->name, $user->id->toRfc4122()));
        $io->writeln($code);
        $io->warning('The invite code is shown here once and not stored; whoever loses it gets a new one (administration: "Neuer Code").');

        return Command::SUCCESS;
    }
}
