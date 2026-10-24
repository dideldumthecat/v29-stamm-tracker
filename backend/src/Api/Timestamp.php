<?php

namespace App\Api;

/**
 * Timestamps as the API contract writes them: ISO 8601 in UTC with milliseconds, "2026-10-22T09:41:10.000Z".
 */
final class Timestamp
{
    public static function format(\DateTimeImmutable $time): string
    {
        return $time->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    public static function parse(mixed $value): ?\DateTimeImmutable
    {
        return (\is_string($value) ? \DateTimeImmutable::createFromFormat('Y-m-d\TH:i:s.vP', $value) : false) ?: null;
    }
}
