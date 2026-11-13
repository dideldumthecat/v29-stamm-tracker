<?php

namespace App\Command;

use App\Api\Tag;
use App\Entity\TimberItem;
use App\Photo\PhotoMover;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

/**
 * Hangs photos on another stem or beam. The source is not given: it is wherever the photo is shown now.
 * This command only turns the tag and the ID beginnings into entities; PhotoMover does the work.
 */
#[AsCommand(name: 'app:photo:move', description: 'Move photos to another stem or beam (voids them at their current item, records them at the target)')]
class PhotoMoveCommand
{
    private const MIN_ID_LENGTH = 8;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly PhotoMover $mover,
        private readonly Superadmin $superadmin,
    ) {
    }

    /**
     * @param list<string> $photos
     */
    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Tag of the target, e.g. 123 or 123-A; leading zeros do not matter')] string $target,
        #[Argument(description: 'Photo IDs, each complete or the first '.self::MIN_ID_LENGTH.' or more characters if they are unambiguous')] array $photos,
        #[Option(description: 'Show what would happen without writing anything')] bool $dryRun = false,
    ): int {
        try {
            $tag = Tag::normalize($target) ?? throw new \DomainException(\sprintf('"%s" is not a tag like 123 or 123-A.', $target));
            $item = $this->em->getRepository(TimberItem::class)->findOneBy(['tagNumber' => $tag, 'voidedAt' => null])
                ?? throw new \DomainException(\sprintf('No timber item with tag %s.', $tag));
            $author = $this->superadmin->author();
            if (\is_string($author)) {
                throw new \DomainException($author);
            }
            $ids = array_map($this->resolve(...), $photos);
            $moves = $dryRun ? $this->mover->plan($ids, $item) : $this->mover->move($ids, $item, $author);
        } catch (\DomainException $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }

        $io->table(['Photo', 'Taken', 'Move'], array_map(static fn ($move) => [
            $move->photoId->toRfc4122(),
            $move->takenAt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s \U\T\C'),
            $move->alreadyAtTarget ? \sprintf('already at %s, skipped', $move->targetTag) : \sprintf('%s → %s', $move->sourceTag ?? '?', $move->targetTag),
        ], $moves));
        $skipped = \count(array_filter($moves, static fn ($move) => $move->alreadyAtTarget));
        $io->success(\sprintf('%s: %d, skipped (already there): %d.', $dryRun ? 'Would move' : 'Moved', \count($moves) - $skipped, $skipped));
        if ($dryRun) {
            $io->note('Dry run, nothing was written.');
        }

        return Command::SUCCESS;
    }

    /**
     * @throws \DomainException if the text names no photo or several
     */
    private function resolve(string $prefix): Uuid
    {
        $hex = strtolower(str_replace('-', '', trim($prefix)));
        if (!preg_match('/^[0-9a-f]+$/', $hex) || \strlen($hex) < self::MIN_ID_LENGTH) {
            throw new \DomainException(\sprintf('"%s" is not a photo ID: give a complete ID or at least the first %d characters.', $prefix, self::MIN_ID_LENGTH));
        }
        $matches = array_map(Uuid::fromBinary(...), $this->em->getConnection()->fetchFirstColumn('SELECT id FROM photos WHERE LOWER(HEX(id)) LIKE ?', [$hex.'%']));
        if (1 === \count($matches)) {
            return $matches[0];
        }

        throw new \DomainException($matches ? \sprintf("\"%s\" matches %d photos, give more characters:\n%s", $prefix, \count($matches), implode("\n", array_map(fn (Uuid $id) => \sprintf('  %s (%s)', $id->toRfc4122(), implode(', ', array_column($this->mover->assignments($id), 'tag')) ?: 'not on any item'), $matches))) : \sprintf('No photo with an ID starting with %s.', $prefix));
    }
}
