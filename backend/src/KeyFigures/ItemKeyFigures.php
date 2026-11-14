<?php

namespace App\KeyFigures;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\TimberItem;
use App\Entity\TimberItemState;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** Loads one stem with its beams (or one beam) and lets KeyFigures calculate: the card of the detail view. */
final class ItemKeyFigures
{
    public function __construct(private readonly EntityManagerInterface $em, private readonly KeyFigures $figures)
    {
    }

    /**
     * @return ?list<KeyFigure> null if there is no such item or it was voided
     *
     * @throws \RuntimeException if an attribute the figures need does not exist
     */
    public function of(Uuid $id): ?array
    {
        $items = $this->em->getRepository(TimberItem::class);
        if (!$item = $items->findOneBy(['id' => $id, 'voidedAt' => null])) {
            return null;
        }
        $all = [$item];
        if (null === $item->parentId) {
            array_push($all, ...$items->findBy(['parentId' => $id, 'voidedAt' => null]));
        }

        $values = [];
        foreach ($this->em->getRepository(TimberItemState::class)->findBy(['timberItemId' => array_map(static fn (TimberItem $one) => $one->id, $all)]) as $state) {
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
        $measures = array_map(static fn (TimberItem $one) => $reader->read($one, $values[$one->id->toRfc4122()] ?? []), $all);

        return null === $item->parentId
            ? $this->figures->stemCard($this->figures->ofStems($measures)[$measures[0]->id], $reader->names())
            : $this->figures->beamCard($this->figures->piece($measures[0]), $reader->names());
    }
}
