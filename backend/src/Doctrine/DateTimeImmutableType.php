<?php

namespace App\Doctrine;

use Doctrine\DBAL\Platforms\AbstractPlatform;
use Doctrine\DBAL\Types\DateTimeImmutableType as BaseDateTimeImmutableType;

/**
 * Replaces the built-in datetime_immutable type (see config/packages/doctrine.yaml): stores UTC and
 * keeps fractions of a second. Columns that need them are declared DATETIME(6) via columnDefinition
 * (the schema comparison does not handle a mapped precision).
 *
 * The built-in type writes whole seconds only. That would drop the milliseconds the app sends and
 * leave the receipt order of events inside one sync ambiguous.
 */
final class DateTimeImmutableType extends BaseDateTimeImmutableType
{
    private const FORMAT = 'Y-m-d H:i:s.u';

    public function convertToDatabaseValue(mixed $value, AbstractPlatform $platform): ?string
    {
        if ($value instanceof \DateTimeImmutable) {
            return $value->setTimezone(new \DateTimeZone('UTC'))->format(self::FORMAT);
        }

        return parent::convertToDatabaseValue($value, $platform);
    }

    public function convertToPHPValue(mixed $value, AbstractPlatform $platform): ?\DateTimeImmutable
    {
        if (\is_string($value)) {
            $date = \DateTimeImmutable::createFromFormat(self::FORMAT, $value, new \DateTimeZone('UTC'));
            if ($date) {
                return $date;
            }
        }

        return parent::convertToPHPValue($value, $platform);
    }
}
