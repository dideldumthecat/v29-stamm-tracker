<?php

namespace App\User;

/** The acting user may not do this to this user (the API answers 403). */
final class UserActionDenied extends \RuntimeException
{
}
