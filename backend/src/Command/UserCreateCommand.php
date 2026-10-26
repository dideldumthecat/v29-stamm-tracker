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

#[AsCommand(name: 'app:user:create', description: 'Create a user and print the invite message with their personal code')]
class UserCreateCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        #[Autowire(env: 'DEFAULT_URI')]
        private readonly string $address,
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

        $code = '';
        for ($i = 0; $i < User::CODE_LENGTH; ++$i) {
            $code .= User::CODE_ALPHABET[random_int(0, \strlen(User::CODE_ALPHABET) - 1)];
        }
        // Only the hash is stored.
        $user = new User($name, $admin ? UserRole::Admin : UserRole::User, User::hashToken($code));
        $formatted = implode('-', str_split($code, 4));
        $this->em->persist($user);
        $this->em->flush();

        $io->success(\sprintf('Created %s "%s" (%s).', $user->role->value, $user->name, $user->id->toRfc4122()));
        $io->writeln(<<<MESSAGE
            Hallo {$user->name},

            hier dein Zugang zum V29 Stamm-Tracker:
            Adresse: {$this->address}
            Dein Code: $formatted (nicht weitergeben)

            iPhone:
            1. Adresse in Safari öffnen.
            2. Unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.
            3. App über das neue Symbol öffnen und den Code eingeben.

            Android:
            1. Adresse in Chrome öffnen.
            2. Oben rechts auf ⋮ tippen, dann „App installieren“ (oder „Zum Startbildschirm hinzufügen“).
            3. App über das neue Symbol öffnen und den Code eingeben.

            Bitte immer über das Symbol öffnen, nicht über den Browser.
            MESSAGE);
        $io->warning('The code is shown only now. They cannot be recovered; revoke the user and create a new one if it is lost.');

        return Command::SUCCESS;
    }
}
