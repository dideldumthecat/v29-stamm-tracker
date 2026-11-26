<?php

namespace App\User;

/** A group with users is not deleted. */
final class GroupInUse extends \RuntimeException
{
}
