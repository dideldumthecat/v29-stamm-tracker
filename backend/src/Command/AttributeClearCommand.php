<?php

namespace App\Command;

use App\Entity\EventType;
use App\Entity\TimberItemEvent;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

/**
 * Clears one attribute on many stems by voiding every recording of it (T03: nothing is deleted, the events stay).
 * All recordings, not only the latest, otherwise an older value would resurface. Beams are never touched.
 * Everything is validated before the first event is written and the events go in one transaction.
 */
#[AsCommand(name: 'app:attribute:clear', description: 'Clear an attribute on many stems at once (voids the recorded values, they stay in the event log)')]
class AttributeClearCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
        private readonly StemSelection $selection,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Attribute key or exact name, e.g. mid_diameter_max or Länge')] string $attribute,
        #[Option(description: 'Stems to clear: all, 119, 1-10 or a list like 1-10,15,20-25 (leading zeros do not matter)')] ?string $range = null,
        #[Option(description: 'Show what would happen without writing anything')] bool $dryRun = false,
        #[Option(description: 'Name or ID of the user the voids are recorded under; default: the only admin')] ?string $user = null,
    ): int {
        $numbers = null === $range ? null : $this->selection->parseRange($range);
        $attr = $this->selection->attribute($attribute);
        $error = match (true) {
            null === $range => '--range is required: all, a number, from-to or a list like 1-10,15.',
            false === $numbers => $this->selection->notARange($range),
            null === $attr => \sprintf('No attribute with the key or name "%s".', $attribute),
            $attr->isSeries => \sprintf('"%s" is a series; a series cannot be cleared for many stems.', $attribute),
            default => null,
        };
        $author = $this->selection->user($user);
        $error ??= \is_string($author) ? $author : null;
        if (null !== $error) {
            $io->error($error);

            return Command::FAILURE;
        }

        // Recordings no void refers to yet, per item, so running the command twice does nothing.
        $recordings = [];
        $rows = $this->em->getConnection()->fetchAllNumeric(
            'SELECT rec.id, rec.timber_item_id FROM timber_item_events rec
                WHERE rec.type = ? AND JSON_VALUE(rec.data, ?) = ?
                AND NOT EXISTS (SELECT 1 FROM timber_item_events void WHERE void.type = ? AND void.reference_id = rec.id)',
            [EventType::AttributeRecorded->value, '$.attribute_id', $attr->id->toRfc4122(), EventType::Voided->value],
        );
        foreach ($rows as [$eventId, $itemId]) {
            $recordings[Uuid::fromBinary($itemId)->toRfc4122()][] = Uuid::fromBinary($eventId);
        }

        $stems = $this->selection->stems();
        $clear = [];
        $missing = [];
        $skipped = 0;
        foreach ($numbers ?? array_keys($stems) as $number) {
            $stem = $stems[$number] ?? null;
            if (null === $stem) {
                $missing[] = $number;
            } elseif (isset($recordings[$stem->id->toRfc4122()])) {
                $clear[] = $stem;
            } else {
                ++$skipped;
            }
        }

        if (!$dryRun) {
            $this->em->wrapInTransaction(function () use ($clear, $recordings, $author): void {
                $now = new \DateTimeImmutable();
                foreach ($clear as $stem) {
                    foreach ($recordings[$stem->id->toRfc4122()] as $eventId) {
                        $this->em->persist(new TimberItemEvent(Uuid::v7(), $stem->id, EventType::Voided, [], $now, $author, $eventId, receivedAt: $now));
                    }
                }
                $this->em->flush();
                foreach ($clear as $stem) {
                    $this->projector->project($stem->id);
                }
            });
        }

        if ($missing) {
            $io->warning(\sprintf('No stem with these numbers: %s.', implode(', ', $missing)));
        }
        $io->success(\sprintf('%s: %d, skipped (no value): %d, no stem found: %d.', $dryRun ? 'Would clear' : 'Cleared', \count($clear), $skipped, \count($missing)));
        if ($dryRun) {
            $io->note('Dry run, nothing was written.');
        }

        return Command::SUCCESS;
    }
}
