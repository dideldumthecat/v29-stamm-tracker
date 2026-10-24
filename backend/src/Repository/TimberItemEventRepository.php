<?php

namespace App\Repository;

use App\Entity\TimberItemEvent;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/**
 * @extends ServiceEntityRepository<TimberItemEvent>
 */
class TimberItemEventRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, TimberItemEvent::class);
    }

    /**
     * The one way to read events for projections: oldest receipt first, so the last event wins.
     * Within a sync received_at is strictly increasing in the order sent (SyncController), so there
     * are no ties; the id only keeps the order stable should two syncs ever share a microsecond.
     *
     * @param Uuid|null $timberItemId only this item's events; null = all (full rebuild)
     *
     * @return list<TimberItemEvent>
     */
    public function findInReceiptOrder(?Uuid $timberItemId = null): array
    {
        $query = $this->createQueryBuilder('event')
            ->orderBy('event.receivedAt', 'ASC')
            ->addOrderBy('event.id', 'ASC');
        if ($timberItemId) {
            $query->where('event.timberItemId = :timberItemId')->setParameter('timberItemId', $timberItemId, 'uuid');
        }

        return $query->getQuery()->getResult();
    }
}
