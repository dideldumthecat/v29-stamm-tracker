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
        private readonly Superadmin $superadmin,
        #[Autowire(env: 'DEFAULT_URI')]
        private readonly string $address,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Name shown as "recorded by"')] string $name,
        #[Option(description: 'user, admin (administration) or superadmin (administration; the console commands record under it; at most one)')] string $role = 'user',
    ): int {
        $name = trim($name);
        $userRole = UserRole::tryFrom($role);
        $error = match (true) {
            '' === $name => 'The name must not be empty.',
            null === $userRole => \sprintf('"%s" is not a role. Use user, admin or superadmin.', $role),
            UserRole::Superadmin === $userRole => $this->superadmin->conflict(),
            default => null,
        };
        if (null !== $error) {
            $io->error($error);

            return Command::FAILURE;
        }

        $code = '';
        for ($i = 0; $i < User::CODE_LENGTH; ++$i) {
            $code .= User::CODE_ALPHABET[random_int(0, \strlen(User::CODE_ALPHABET) - 1)];
        }
        // Only the hash is stored.
        $user = new User($name, $userRole, User::hashToken($code));
        $formatted = implode('-', str_split($code, 4));
        $this->em->persist($user);
        $this->em->flush();

        $io->success(\sprintf('Created %s "%s" (%s).', $user->role->value, $user->name, $user->id->toRfc4122()));
        $io->writeln(<<<MESSAGE
            Hallo {$user->name},

            hier dein Zugang zum V29 Stamm-Tracker:
            Adresse: {$this->address}
            Dein Einladungscode: $formatted

            iPhone:
            1. Adresse in Safari öffnen (nicht direkt in WhatsApp o. Ä.).
            2. Auf die drei Punkte neben der Adressleiste tippen, dann auf „Teilen“. (Bei älteren iPhones direkt unten auf „Teilen“ tippen.)
            3. Auf „Zum Home-Bildschirm“ tippen (falls nicht sichtbar, vorher auf „Mehr anzeigen“). „Als Web-App öffnen“ eingeschaltet lassen und auf „Hinzufügen“ tippen.
            4. App über das neue Symbol öffnen und den Einladungscode eingeben.

            Android:
            1. Adresse in Chrome öffnen (nicht direkt in WhatsApp o. Ä.).
            2. Oben rechts auf ⋮ tippen, dann auf „App installieren“ (oder „Zum Startbildschirm hinzufügen“).
            3. App über das neue Symbol öffnen und den Einladungscode eingeben.

            Bitte danach IMMER über das Symbol öffnen, nicht über den Browser.
            MESSAGE);
        $io->warning('The invite code is shown only now. It cannot be recovered; revoke the user and create a new one if it is lost.');

        return Command::SUCCESS;
    }
}
