<?php

namespace App\Sync;

/** Request that SyncProcessor refuses as a whole; the message names the first bad event. */
final class InvalidSync extends \RuntimeException
{
}
