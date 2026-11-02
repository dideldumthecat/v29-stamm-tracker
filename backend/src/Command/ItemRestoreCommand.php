<?php

namespace App\Command;

use App\Api\Tag;
use App\Entity\EventType;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

/**
 * Undoes app:item:void or a beam removed in the app. Appends a restored event per voided event it lifts; nothing is deleted.
 */
#[AsCommand(name: 'app:item:restore', description: 'Restore a voided stem or beam by its tag (it returns to the snapshot, its events stay)')]
class ItemRestoreCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
        private readonly StemSelection $selection,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Tag, e.g. 123 or 123-A; leading zeros do not matter')] string $tag,
        #[Option(description: 'Show what would happen without writing anything')] bool $dryRun = false,
        #[Option(description: 'Name or ID of the user the restore is recorded under; default: the only admin')] ?string $user = null,
    ): int {
        $normalized = Tag::normalize($tag);
        if (null === $normalized) {
            $io->error(\sprintf('"%s" is not a tag like 123 or 123-A.', $tag));

            return Command::FAILURE;
        }
        $tag = $normalized;

        $items = $this->em->getRepository(TimberItem::class);
        $voided = $items->createQueryBuilder('item')
            ->where('item.tagNumber = :tag AND item.voidedAt IS NOT NULL')
            ->orderBy('item.voidedAt', 'DESC')
            ->setMaxResults(1)
            ->setParameter('tag', $tag)
            ->getQuery()->getOneOrNullResult();
        if (!$voided) {
            $io->error(\sprintf('No voided timber item with tag %s.', $tag));

            return Command::FAILURE;
        }
        $author = $this->selection->user($user);
        if (\is_string($author)) {
            $io->error($author);

            return Command::FAILURE;
        }

        $parent = $voided->parentId ? $this->em->find(TimberItem::class, $voided->parentId) : null;
        // Several voids happen when the app removes a beam that is gone already: all of them have to be lifted.
        $voids = $this->openVoids($voided->id);
        $last = $voids ? $voids[array_key_last($voids)] : null;
        $db = $this->em->getConnection();
        $io->definitionList(...[
            ['Type' => $parent ? 'Beam' : 'Stem'],
            ['Tag' => $voided->tagNumber],
            ...$parent ? [['Stem' => $parent->tagNumber]] : [],
            ['Recorded values' => $db->fetchOne(
                'SELECT COUNT(*) FROM timber_item_events WHERE timber_item_id = ? AND type = ?',
                [$voided->id, EventType::AttributeRecorded->value],
                [UuidType::NAME],
            )],
            ...$last ? [['Voided' => \sprintf('%s by %s', $last->receivedAt->setTimezone(new \DateTimeZone('Europe/Berlin'))->format('Y-m-d H:i'), $last->user->name)]] : [],
        ]);

        if ($parent?->voidedAt) {
            $io->error(\sprintf('Not restored: stem %s is voided. Restore the stem first.', $parent->tagNumber));

            return Command::FAILURE;
        }
        $holder = $items->findOneBy(['tagNumber' => $tag, 'voidedAt' => null]);
        if ($holder) {
            $holderStem = $holder->parentId ? $this->em->find(TimberItem::class, $holder->parentId) : null;
            $io->error(\sprintf(
                'Not restored: tag %s is taken by another %s (created %s). Void that one first.',
                $tag,
                $holderStem ? "beam of stem {$holderStem->tagNumber}" : 'stem',
                $holder->createdAt->setTimezone(new \DateTimeZone('Europe/Berlin'))->format('Y-m-d H:i'),
            ));

            return Command::FAILURE;
        }
        if ($dryRun) {
            $io->success(\sprintf('Would restore %s.', $tag));
            $io->note('Dry run, nothing was written.');

            return Command::SUCCESS;
        }

        $this->em->wrapInTransaction(function () use ($voided, $voids, $author): void {
            $now = new \DateTimeImmutable();
            foreach ($voids as $void) {
                $this->em->persist(new TimberItemEvent(Uuid::v7(), $voided->id, EventType::Restored, [], $now, $author, $void->id, $now));
            }
            $this->em->flush();
            // The parent re-projects its beams, the restored one included: its has_children may change.
            $this->projector->project($voided->parentId ?? $voided->id);
        });
        $io->success(\sprintf('Restored %s.', $tag));

        return Command::SUCCESS;
    }

    /**
     * Voided events that void the whole item (not one recording) and that no restored event lifts, oldest first.
     *
     * @return list<TimberItemEvent>
     */
    private function openVoids(Uuid $itemId): array
    {
        $events = $this->em->getRepository(TimberItemEvent::class)->findInReceiptOrder($itemId);
        $recordings = [];
        $restored = [];
        foreach ($events as $event) {
            if (EventType::AttributeRecorded === $event->type) {
                $recordings[$event->id->toRfc4122()] = true;
            } elseif (EventType::Restored === $event->type) {
                $restored[$event->referenceId?->toRfc4122()] = true;
            }
        }

        return array_values(array_filter($events, static fn (TimberItemEvent $event) => EventType::Voided === $event->type
            && !isset($recordings[$event->referenceId?->toRfc4122()]) && !isset($restored[$event->id->toRfc4122()])));
    }
}
