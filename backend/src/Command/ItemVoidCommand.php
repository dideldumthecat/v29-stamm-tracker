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
 * For items created by mistake and real duplicates. Appends a voided event; nothing is deleted.
 * The item leaves the snapshot and its tag is free again; a voided beam keeps its letter taken.
 */
#[AsCommand(name: 'app:item:void', description: 'Void a stem or beam by its tag (it leaves the snapshot, its events stay)')]
class ItemVoidCommand
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
        #[Option(description: 'Name or ID of the user the void is recorded under; default: the only admin')] ?string $user = null,
    ): int {
        $normalized = Tag::normalize($tag);
        if (null === $normalized) {
            $io->error(\sprintf('"%s" is not a tag like 123 or 123-A.', $tag));

            return Command::FAILURE;
        }
        $tag = $normalized;

        $items = $this->em->getRepository(TimberItem::class);
        $item = $items->findOneBy(['tagNumber' => $tag, 'voidedAt' => null]);
        if (!$item) {
            $io->error(\sprintf('No timber item with tag %s.', $tag));

            return Command::FAILURE;
        }
        $author = $this->selection->user($user);
        if (\is_string($author)) {
            $io->error($author);

            return Command::FAILURE;
        }

        $db = $this->em->getConnection();
        $parent = $item->parentId ? $this->em->find(TimberItem::class, $item->parentId) : null;
        $io->definitionList(...[
            ['Type' => $parent ? 'Beam' : 'Stem'],
            ['Tag' => $item->tagNumber],
            ...$parent ? [['Stem' => $parent->tagNumber]] : [],
            ['Recorded values' => $db->fetchOne(
                'SELECT COUNT(*) FROM timber_item_events WHERE timber_item_id = ? AND type = ?',
                [$item->id, EventType::AttributeRecorded->value],
                [UuidType::NAME],
            )],
        ]);

        $beams = $items->findBy(['parentId' => $item->id, 'voidedAt' => null]);
        if ($beams) {
            $io->error(\sprintf('Not voided: void its beams first: %s.', implode(', ', array_map(static fn (TimberItem $beam) => $beam->tagNumber, $beams))));

            return Command::FAILURE;
        }
        if ($dryRun) {
            $io->success(\sprintf('Would void %s.', $tag));
            $io->note('Dry run, nothing was written.');

            return Command::SUCCESS;
        }

        $created = $db->fetchOne(
            'SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ?',
            [$item->id, EventType::Created->value],
            [UuidType::NAME],
        );
        $this->em->wrapInTransaction(function () use ($item, $author, $created): void {
            $this->em->persist(new TimberItemEvent(Uuid::v7(), $item->id, EventType::Voided, [], new \DateTimeImmutable(), $author, Uuid::fromBinary($created)));
            $this->em->flush();
            // The parent re-projects its beams, the voided one included: its has_children may change.
            $this->projector->project($item->parentId ?? $item->id);
        });
        $io->success(\sprintf('Voided %s.', $tag));

        return Command::SUCCESS;
    }
}
