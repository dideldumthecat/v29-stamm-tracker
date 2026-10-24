<?php

namespace App\Command;

use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

#[AsCommand(name: 'app:projections:rebuild', description: 'Empty timber_items and timber_item_state and rebuild them from all events')]
class ProjectionsRebuildCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $db = $this->em->getConnection();
        // One transaction: the API never sees half-empty tables. DELETE, not TRUNCATE, which would commit implicitly.
        $count = $db->transactional(function () use ($db): int {
            $db->executeStatement('DELETE FROM timber_item_state');
            $db->executeStatement('DELETE FROM timber_items');
            $ids = $db->fetchFirstColumn('SELECT DISTINCT timber_item_id FROM timber_item_events');
            foreach ($ids as $id) {
                $this->projector->project(Uuid::fromBinary($id));
                $this->em->clear();
            }

            return \count($ids);
        });

        $io->success(\sprintf('Rebuilt %d timber items.', $count));

        return Command::SUCCESS;
    }
}
