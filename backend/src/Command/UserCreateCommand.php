<?php

namespace App\Command;

use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

#[AsCommand(name: 'app:user:create', description: 'Create a user and print their personal invite link')]
class UserCreateCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        #[Autowire(env: 'APP_PUBLIC_URL')]
        private readonly string $publicUrl,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Name shown as "recorded by"')] string $name,
        #[Option(description: 'Give the user the admin role')] bool $admin = false,
    ): int {
        $name = trim($name);
        if ('' === $name) {
            $io->error('The name must not be empty.');

            return Command::FAILURE;
        }

        // 32 random bytes as base64url: URL-safe without escaping. Only the hash is stored.
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $user = new User($name, $admin ? UserRole::Admin : UserRole::User, User::hashToken($token));
        $this->em->persist($user);
        $this->em->flush();

        $io->success(\sprintf('Created %s "%s" (%s).', $user->role->value, $user->name, $user->id->toRfc4122()));
        // The token sits in the fragment (#): browsers never send it to the server, so it stays out of access logs.
        $io->writeln(rtrim($this->publicUrl, '/').'/invite#'.$token);
        $io->warning('The link is shown only now. It cannot be recovered; revoke the user and create a new one if it is lost.');

        return Command::SUCCESS;
    }
}
