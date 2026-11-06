<?php

namespace App\Entity;

enum UserRole: string
{
    case User = 'user';
    case Admin = 'admin';
    /** At most one (enforced by the console commands): the account the console commands record under. */
    case Superadmin = 'superadmin';

    /** The one place that decides who may use the administration. */
    public function canAdminister(): bool
    {
        return self::User !== $this;
    }
}
