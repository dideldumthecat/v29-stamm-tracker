<?php

namespace App\Command;

use App\Entity\EventType;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
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
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Argument(description: 'Tag, e.g. 123 or 123-A; leading zeros do not matter')] string $tag,
        #[Option(description: 'Skip the confirmation; required with --no-interaction')] bool $force = false,
    ): int {
        // Counter principle as in the app: 0123-a is 123-A.
        if (!preg_match('/^0*(\d+)(?:-([A-Za-z]))?$/', $tag, $match)) {
            $io->error(\sprintf('"%s" is not a tag like 123 or 123-A.', $tag));

            return Command::FAILURE;
        }
        $tag = $match[1].(isset($match[2]) ? '-'.strtoupper($match[2]) : '');

        $items = $this->em->getRepository(TimberItem::class);
        $item = $items->findOneBy(['tagNumber' => $tag, 'voidedAt' => null]);
        if (!$item) {
            $io->error(\sprintf('No timber item with tag %s.', $tag));

            return Command::FAILURE;
        }
        $admins = $this->em->getRepository(User::class)->findBy(['role' => UserRole::Admin, 'revokedAt' => null]);
        if (1 !== \count($admins)) {
            // TODO: a --user option once there are several admins.
            $io->error($admins
                ? \sprintf('The void is recorded under the admin, but there are several: %s. Revoke all but one: app:user:revoke <ID>, IDs via app:user:list.', implode(', ', array_map(static fn (User $admin) => $admin->name, $admins)))
                : 'The void is recorded under the admin, but there is none. Create one: app:user:create "Name" --admin');

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
        if (!$force && !$input->isInteractive()) {
            $io->error('Not voided: confirmation needed. Run interactively or add --force.');

            return Command::FAILURE;
        }
        if (!$force && !$io->confirm(\sprintf('Void %s?', $tag), false)) {
            $io->note('Nothing voided.');

            return Command::FAILURE;
        }

        $created = $db->fetchOne(
            'SELECT id FROM timber_item_events WHERE timber_item_id = ? AND type = ?',
            [$item->id, EventType::Created->value],
            [UuidType::NAME],
        );
        $this->em->wrapInTransaction(function () use ($item, $admins, $created): void {
            $this->em->persist(new TimberItemEvent(Uuid::v7(), $item->id, EventType::Voided, [], new \DateTimeImmutable(), $admins[0], Uuid::fromBinary($created)));
            $this->em->flush();
            // The parent re-projects its beams, the voided one included: its has_children may change.
            $this->projector->project($item->parentId ?? $item->id);
        });
        $io->success(\sprintf('Voided %s.', $tag));

        return Command::SUCCESS;
    }
}
