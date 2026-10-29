<?php

namespace App\Api;

final class Tag
{
    /**
     * Counter principle as in the app: "0123-a" is "123-A". Null if the text is not a tag.
     */
    public static function normalize(string $text): ?string
    {
        return preg_match('/^0*(\d+)(?:-([A-Za-z]))?$/', $text, $match) ? $match[1].(isset($match[2]) ? '-'.strtoupper($match[2]) : '') : null;
    }
}
