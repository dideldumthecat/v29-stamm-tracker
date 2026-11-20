<?php

namespace App\KeyFigures;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\TimberItem;
use App\Entity\TimberItemState;
use Doctrine\ORM\EntityManagerInterface;

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

        return [array_map(static fn (TimberItem $item) => $reader->read($item, $values[$item->id->toRfc4122()] ?? []), $items), $reader->names()];
    }
}
