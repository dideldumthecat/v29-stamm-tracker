<?php

namespace App\Command;

use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Deliberately breaks the append-only rule of timber_item_events: only for test data before go-live.
 *
 * Always refused in prod, so it cannot wipe real data there.
 *
 * TODO: remove this command once real data is captured and no test data needs resetting anymore.
 */
#[AsCommand(name: 'app:reset', description: 'TEST DATA ONLY, breaks the append-only event log: delete all events and projections (with --attributes also attributes and options); users stay')]
class ResetCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        #[Autowire('%kernel.environment%')]
        private readonly string $environment,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Option(description: 'Also delete attributes and their options')] bool $attributes = false,
        #[Option(description: 'Required with --no-interaction')] bool $force = false,
    ): int {
        if ('prod' === $this->environment) {
            $io->error('Refused: this is the production environment (APP_ENV=prod).');

            return Command::FAILURE;
        }

        // In deletion order: children before the tables their foreign keys point to.
        $tables = ['timber_item_state', 'timber_items', 'timber_item_events', ...$attributes ? ['attribute_options', 'attributes'] : []];
        $db = $this->em->getConnection();
        $io->table(['Table', 'Rows'], array_map(static fn (string $table) => [$table, $db->fetchOne("SELECT COUNT(*) FROM $table")], $tables));

        if (!$input->isInteractive() && !$force) {
            $io->error('Not deleted: confirmation needed. Run interactively or add --force.');

            return Command::FAILURE;
        }
        if ($input->isInteractive() && !$io->confirm('Delete all these rows? Users are kept.', false)) {
            $io->note('Nothing deleted.');

            return Command::FAILURE;
        }

        // DELETE, not TRUNCATE, which would commit implicitly.
        $db->transactional(function () use ($db, $tables): void {
            foreach ($tables as $table) {
                $db->executeStatement("DELETE FROM $table");
            }
        });
        $io->success('Deleted.');

        return Command::SUCCESS;
    }
}
