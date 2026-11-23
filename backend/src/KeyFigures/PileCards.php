<?php

namespace App\KeyFigures;

use App\Entity\TimberItem;
use App\Pile\PileEditor;
use Doctrine\ORM\EntityManagerInterface;

/** PileCardsResponse in frontend/shared/contract.ts: loads every item that is not voided and lets PileSections build the cards. */
final class PileCards
{
    public function __construct(private readonly EntityManagerInterface $em, private readonly MeasureLoader $loader, private readonly PileEditor $piles, private readonly PileSections $sections)
    {
    }

    /**
     * @param \DateTimeImmutable $now decides which week is the current one
     *
     * @return array{sections: list<array<string, mixed>>}
     *
     * @throws \RuntimeException if an attribute the figures need does not exist
     */
    public function build(\DateTimeImmutable $now = new \DateTimeImmutable()): array
    {
        [$measures, $names] = $this->loader->load($this->em->getRepository(TimberItem::class)->findBy(['voidedAt' => null]));

        return ['sections' => $this->sections->build($measures, $this->piles->all(), $names, $now)];
    }
}
