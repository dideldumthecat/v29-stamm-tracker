<?php

namespace App\Report;

use App\Entity\Attribute;
use App\Entity\AttributeType;

/**
 * A recorded value as text, in two variants that differ only where a person reads and Excel does not:
 * - forExport(): the text cells of the export (TimberReport). Numbers are cells of their own there, so this keeps the raw value.
 * - forDisplay(): what the administration shows. Numbers and months are written as V29 reads them, as in the app.
 */
final class ValueText
{
    private const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    /**
     * @param array<string, string> $optionLabels option label by option id (RFC 4122), for choices
     */
    public static function forExport(AttributeType $type, bool|int|float|string $value, array $optionLabels): string
    {
        return match ($type) {
            AttributeType::Boolean => $value ? 'ja' : 'nein',
            AttributeType::Choice => $optionLabels[$value] ?? (string) $value,
            AttributeType::Date => (new \DateTimeImmutable((string) $value))->format('d.m.Y'),
            default => (string) $value,
        };
    }

    /**
     * Numbers as formatNumber and formatValue in frontend/app/src/utils/attributeDraft.ts write them (decimal comma, then
     * the unit): keep both in step. Dates are written the same in the app and in the export, months in words.
     *
     * @param array<string, string> $optionLabels
     */
    public static function forDisplay(Attribute $attribute, bool|int|float|string $value, array $optionLabels): string
    {
        return match ($attribute->type) {
            AttributeType::Number => trim(str_replace('.', ',', (string) $value).' '.$attribute->unit),
            AttributeType::Month => self::MONTHS[(int) substr((string) $value, 5, 2) - 1].' '.substr((string) $value, 0, 4),
            default => self::forExport($attribute->type, $value, $optionLabels),
        };
    }
}
