<?php

namespace App\KeyFigures;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\EventType;
use App\Entity\TimberItem;
use App\Entity\TimberItemState;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** Reads the measures of items from the projections, whose values are already effective (own, or inherited from the stem). */
final class MeasureLoader
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /**
     * @param list<TimberItem> $items
     *
     * @return array{list<Measures>, array<string, string>} the measures in the order of the items, and the attribute names by key
     *
     * @throws \RuntimeException if an attribute the figures need does not exist
     */
    public function load(array $items): array
    {
        $values = [];
        $states = [] === $items ? [] : $this->em->getRepository(TimberItemState::class)->findBy(['timberItemId' => array_map(static fn (TimberItem $item) => $item->id, $items)]);
        foreach ($states as $state) {
            $values[$state->timberItemId->toRfc4122()][$state->attributeId->toRfc4122()] = $state->valueRecords;
        }
        $attributes = [];
        foreach ($this->em->getRepository(Attribute::class)->findAll() as $attribute) {
            if (null !== $attribute->key) {
                $attributes[$attribute->key] = $attribute;
            }
        }
        $options = [];
        foreach ($this->em->getRepository(AttributeOption::class)->findAll() as $option) {
            $options[$option->id->toRfc4122()] = $option->label;
        }
        $reader = new MeasureReader($attributes, $options);

        $firstSawn = $this->firstYes($items, $attributes['sawn']);
        $firstUnsawable = isset($attributes['unsawable']) ? $this->firstYes($items, $attributes['unsawable']) : [];

        return [array_map(static fn (TimberItem $item) => $reader->read($item, $values[$id = $item->id->toRfc4122()] ?? [], $firstSawn[$id] ?? null, $firstUnsawable[$id] ?? null), $items), $reader->names()];
    }

    /**
     * Device time of the first recording of a yes/no attribute ("sawn", "unsawable") as yes, per item id. The projection keeps only the latest value, so this reads the events.
     * A voided recording does not count (as in the projection). JSON_VALUE gives a boolean as 'true' or '1' depending on the MariaDB version.
     *
     * @param list<TimberItem> $items
     *
     * @return array<string, \DateTimeImmutable>
     */
    private function firstYes(array $items, Attribute $attribute): array
    {
        if ([] === $items) {
            return [];
        }
        $rows = $this->em->getConnection()->fetchAllKeyValue(
            'SELECT e.timber_item_id, MIN(e.recorded_at) FROM timber_item_events e
              WHERE e.type = ? AND e.timber_item_id IN (?) AND JSON_VALUE(e.data, ?) = ? AND JSON_VALUE(e.data, ?) IN (?, ?)
                AND NOT EXISTS (SELECT 1 FROM timber_item_events v WHERE v.type = ? AND v.reference_id = e.id)
              GROUP BY e.timber_item_id',
            [EventType::AttributeRecorded->value, array_map(static fn (TimberItem $item) => $item->id->toBinary(), $items), '$.attribute_id', $attribute->id->toRfc4122(), '$.value', 'true', '1', EventType::Voided->value],
            [1 => ArrayParameterType::BINARY],
        );
        $first = [];
        foreach ($rows as $id => $at) {
            $first[Uuid::fromBinary($id)->toRfc4122()] = new \DateTimeImmutable($at, new \DateTimeZone('UTC'));
        }

        return $first;
    }
}
