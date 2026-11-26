<?php

namespace App\User;

use App\Entity\User;

/**
 * Invite codes: made here, shared by the console command and the administration (both show only the code).
 *
 * The code is a password: only its hash is stored (`users.token_hash`, how the user is found at sign-in). It is shown once, when it is issued;
 * whoever loses it gets a new one.
 */
final class Invites
{
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

    private static function format(string $code): string
    {
        return implode('-', str_split($code, 4));
    }
}
