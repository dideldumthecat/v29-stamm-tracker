<?php

namespace App\Command;

use App\Projection\TimberItemProjector;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:projections:rebuild', description: 'Empty timber_items and timber_item_state and rebuild them from all events')]
class ProjectionsRebuildCommand
{
    public function __construct(private readonly TimberItemProjector $projector)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $io->success(\sprintf('Rebuilt %d timber items.', $this->projector->rebuildAll()));

        return Command::SUCCESS;
    }
}
