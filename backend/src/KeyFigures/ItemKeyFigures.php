<?php

namespace App\KeyFigures;

use App\Entity\TimberItem;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** Loads one stem with its beams (or one beam) and lets KeyFigures calculate: the card of the detail view. */
final class ItemKeyFigures
{
    public function __construct(private readonly EntityManagerInterface $em, private readonly MeasureLoader $loader, private readonly KeyFigures $figures)
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
        [$measures, $names] = $this->loader->load($all);

        return null === $item->parentId
            ? $this->figures->stemCard($this->figures->ofStems($measures)[$measures[0]->id], $names)
            : $this->figures->beamCard($this->figures->piece($measures[0]), $names);
    }
}
