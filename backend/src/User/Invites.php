<?php

namespace App\User;

use App\Entity\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Invite codes: made here, shared by the console command and the administration.
 *
 * The code is a password: only its hash is stored (`users.token_hash`, how the user is found at sign-in). It is shown once, when it is issued;
 * whoever loses it gets a new one.
 */
final class Invites
{
    public function __construct(
        #[Autowire(env: 'DEFAULT_URI')]
        private readonly string $address,
    ) {
    }

    /**
     * Gives the user a new code (the old one stops working at once) and returns it, formatted for display.
     */
    public function issue(User $user): string
    {
        $code = '';
        for ($i = 0; $i < User::CODE_LENGTH; ++$i) {
            $code .= User::CODE_ALPHABET[random_int(0, \strlen(User::CODE_ALPHABET) - 1)];
        }
        $user->tokenHash = User::hashToken($code);

        return self::format($code);
    }

    public static function format(string $code): string
    {
        return implode('-', str_split($code, 4));
    }

    /** The text sent to the person, with the formatted code. */
    public function message(User $user, string $formattedCode): string
    {
        return <<<MESSAGE
            Hallo {$user->name},

            hier dein Zugang zum V29 Stamm-Tracker:
            Adresse: {$this->address}
            Dein Einladungscode: $formattedCode

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
            MESSAGE;
    }
}
