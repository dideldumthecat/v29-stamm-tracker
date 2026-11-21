<?php

namespace App\KeyFigures;

use App\Api\Timestamp;
use App\Entity\TimberItem;
use App\Pile\PileEditor;
use Doctrine\ORM\EntityManagerInterface;

/** DashboardResponse in frontend/shared/contract.ts: loads every item that is not voided and lets KeyFigures add up. */
final class Dashboard
{
    public function __construct(private readonly EntityManagerInterface $em, private readonly MeasureLoader $loader, private readonly KeyFigures $figures, private readonly PileEditor $piles, private readonly PileSections $pileSections)
    {
    }

    /**
     * @param \DateTimeImmutable $now decides which week is the current one on the pile cards
     *
     * @return array{last_sync_at: ?string, sections: list<array<string, mixed>>}
     *
     * @throws \RuntimeException if an attribute the figures need does not exist
     */
    public function build(\DateTimeImmutable $now = new \DateTimeImmutable()): array
    {
        [$measures, $names] = $this->loader->load($this->em->getRepository(TimberItem::class)->findBy(['voidedAt' => null]));
        // Server time of the last thing a phone brought in: an event or a photo (photos are uploaded apart from the sync). Rejected syncs do not count.
        $last = $this->em->getConnection()->fetchOne('SELECT MAX(at) FROM (SELECT MAX(received_at) AS at FROM timber_item_events UNION ALL SELECT MAX(uploaded_at) FROM photos) AS latest');

        return [
            'last_sync_at' => \is_string($last) ? Timestamp::format(new \DateTimeImmutable($last, new \DateTimeZone('UTC'))) : null,
            'sections' => [
                ['type' => 'figures', 'key' => 'sawing', 'label' => 'Kennzahlen: Sägen', 'figures' => $this->figures->sawing($measures, $names)],
                ['type' => 'diameter_classes', 'key' => 'stems_by_diameter', 'label' => 'Stämme nach Mittendurchmesser', ...$this->figures->diameterClasses($measures, $names)],
                ...$this->pileSections->build($measures, $this->piles->all(), $names, $now),
            ],
        ];
    }
}
