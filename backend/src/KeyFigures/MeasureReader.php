<?php

namespace App\KeyFigures;

use App\Entity\Attribute;
use App\Entity\TimberItem;
use App\Report\ValueText;

/**
 * Reads the numbers out of the effective values of an item (own, or inherited from the stem: that is what the projection holds).
 * Attributes are found by key only. Length and cross-section are choices whose text carries the numbers ("4,10 m", "14,7 x 14,7 cm").
 * Does no loading: the caller hands over the attributes, option labels and values it has loaded, for one item or all.
 */
final class MeasureReader
{
    public const KEYS = ['mid_diameter_max', 'mid_diameter_min', 'length', 'sawn', 'sawn_cross_section'];

    /** @var array<string, array{tag: ?string, item: string, attribute: string, text: string}> texts that were not readable, once each */
    private array $unreadable = [];

    /**
     * @param array<string, Attribute> $attributes   by key, at least KEYS
     * @param array<string, string>    $optionLabels by option id
     *
     * @throws \RuntimeException if an attribute the figures need does not exist
     */
    public function __construct(private readonly array $attributes, private readonly array $optionLabels)
    {
        if ($missing = array_diff(self::KEYS, array_keys($attributes))) {
            throw new \RuntimeException(\sprintf('The key figures need attributes with the keys: %s. Missing in the database: %s.', implode(', ', self::KEYS), implode(', ', $missing)));
        }
    }

    /** @return array<string, string> attribute names by key, for the texts that explain a formula */
    public function names(): array
    {
        return array_map(static fn (Attribute $attribute) => $attribute->name, $this->attributes);
    }

    /** @return list<array{tag: ?string, item: string, attribute: string, text: string}> */
    public function unreadable(): array
    {
        return array_values($this->unreadable);
    }

    /** @param array<string, list<array{value: bool|int|float|string, recorded_at: string, user_id: string, event_id: string}>> $values records by attribute id */
    public function read(TimberItem $item, array $values): Measures
    {
        $number = fn (string $key, int $count): ?array => $this->numbers($item, $values, $this->attributes[$key], $count);
        // Only stems have diameters; a beam that inherited them is not asked.
        $isStem = null === $item->parentId;
        $max = $isStem ? $number('mid_diameter_max', 1)[0] ?? null : null;
        $min = $isStem ? $number('mid_diameter_min', 1)[0] ?? null : null;
        $length = $number('length', 1)[0] ?? null;
        [$width, $height] = $number('sawn_cross_section', 2) ?? [null, null];

        return new Measures(
            $item->id->toRfc4122(),
            $item->parentId?->toRfc4122(),
            $item->tagNumber,
            $max,
            $min,
            $length,
            $width,
            $height,
            [] !== ($values[$this->attributes['sawn_cross_section']->id->toRfc4122()] ?? []),
            $this->marked($values, 'sawn'),
            // Optional: only the dashboard asks (it checks that the attribute exists), the export and the detail view work without it.
            isset($this->attributes['unsawable']) && $this->marked($values, 'unsawable'),
        );
    }

    /** @param array<string, list<array{value: bool|int|float|string, recorded_at: string, user_id: string, event_id: string}>> $values */
    private function marked(array $values, string $key): bool
    {
        return (bool) ($values[$this->attributes[$key]->id->toRfc4122()][0]['value'] ?? false);
    }

    /**
     * The numbers in the displayed text ("4,10 m" → 4.1), exactly $count of them; otherwise null, and a note of it if there is a text.
     *
     * @param array<string, list<array{value: bool|int|float|string, recorded_at: string, user_id: string, event_id: string}>> $values
     *
     * @return ?list<float>
     */
    private function numbers(TimberItem $item, array $values, Attribute $attribute, int $count): ?array
    {
        $records = $values[$attribute->id->toRfc4122()] ?? [];
        if ([] === $records) {
            return null;
        }
        $text = ValueText::forExport($attribute->type, $records[0]['value'], $this->optionLabels);
        preg_match_all('/\d+(?:[.,]\d+)?/', $text, $match);
        if (\count($found = $match[0]) !== $count) {
            $this->unreadable[$item->id->toRfc4122().$attribute->id->toRfc4122()] = ['tag' => $item->tagNumber, 'item' => $item->id->toRfc4122(), 'attribute' => $attribute->name, 'text' => $text];

            return null;
        }

        return array_map(static fn (string $number) => (float) str_replace(',', '.', $number), $found);
    }
}
