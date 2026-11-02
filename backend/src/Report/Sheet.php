<?php

namespace App\Report;

/**
 * A table for the Excel export: a heading and an Excel number format per column, then the rows as plain values
 * (string, int, float, \DateTimeInterface or null).
 */
final readonly class Sheet
{
    public const int MIN_WIDTH = 6;
    public const int MAX_WIDTH = 50;
    private const int PADDING = 2;

    /**
     * @param list<string>      $headers
     * @param list<?string>     $formats   Excel format code per column, e.g. "0.00"; null = as is
     * @param list<list<mixed>> $rows
     * @param list<int>         $unwrapped columns whose text never wraps but runs over to the right (only sensible for the last column)
     */
    public function __construct(
        public string $name,
        public array $headers,
        public array $formats,
        public array $rows,
        public array $unwrapped = [],
    ) {
    }

    /**
     * Excel stores no automatic width, so it is computed: the longest displayed cell text of the column (the longest
     * line, as text with line breaks wraps) or, for the heading, only its longest word, because headings wrap.
     *
     * @return list<float>
     */
    public function columnWidths(): array
    {
        $widths = [];
        foreach ($this->headers as $index => $header) {
            $longest = max(array_map(mb_strlen(...), preg_split('/\s+/', $header) ?: ['']));
            foreach ($this->rows as $row) {
                $longest = max($longest, ...array_map(mb_strlen(...), explode("\n", self::displayed($row[$index] ?? null, $this->formats[$index]))));
            }
            $widths[] = (float) min(self::MAX_WIDTH, max(self::MIN_WIDTH, $longest + self::PADDING));
        }

        return $widths;
    }

    /** The text Excel shows for the value in a cell with this format. */
    public static function displayed(mixed $value, ?string $format): string
    {
        return match (true) {
            null === $value => '',
            $value instanceof \DateTimeInterface => $value->format(str_contains($format ?? '', 'hh') ? 'd.m.Y H:i' : 'd.m.Y'),
            \is_float($value) && '0 %' === $format => number_format($value * 100, 0, ',', '').' %',
            \is_float($value) && null !== $format => number_format($value, \strlen($format) - 2, ',', ''),
            default => (string) $value,
        };
    }
}
