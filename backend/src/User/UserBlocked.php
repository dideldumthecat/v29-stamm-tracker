<?php

namespace App\User;

/** The user is blocked, so an invite cannot be issued (the API answers 409). */
final class UserBlocked extends \RuntimeException
{
}
