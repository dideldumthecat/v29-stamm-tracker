<?php

namespace App\Command;

use App\Api\Tag;
use App\Entity\Attribute;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\Photo;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\User;
use App\Photo\PhotoStorage;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

/**
 * Attaches JPEGs to stems and beams by tag, the same way the app will: a Photo row plus an attribute_recorded event
 * on the photo attribute. Every row is its own transaction, so an aborted run leaves a consistent state and the
 * next run carries on (files already imported are recognized by checksum and item).
 */
#[AsCommand(name: 'app:photo:import', description: 'Attach photos to stems and beams from a CSV with the columns file and tag (comma or semicolon)')]
class PhotoImportCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
        private readonly PhotoStorage $storage,
        private readonly Superadmin $superadmin,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'CSV with the header file,tag or file;tag (separator as in the header), file paths relative to the CSV')] string $csv,
        #[Option(description: 'Show what would happen without writing anything')] bool $dryRun = false,
    ): int {
        $rows = $this->readCsv($csv, $error);
        $attributes = $this->em->getRepository(Attribute::class)->findBy(['type' => AttributeType::Photo, 'active' => true]);
        $author = $this->superadmin->author();
        $error ??= match (true) {
            1 !== \count($attributes) => \sprintf('Expected exactly one active attribute of type photo, found %d. Create it with app:attributes:import.', \count($attributes)),
            \is_string($author) => $author,
            default => null,
        };
        if (null !== $error) {
            $io->error($error);

            return Command::FAILURE;
        }

        $imported = [];
        $skipped = [];
        $seen = [];
        foreach ($rows as $line => [$file, $tag]) {
            $reason = $this->importRow(dirname($csv), $file, $tag, $attributes[0], $author, $seen, $dryRun);
            if (null === $reason) {
                $imported[] = [$line, $file, $tag];
            } else {
                $skipped[] = [$line, $file, $tag, $reason];
            }
        }

        if ($skipped) {
            $io->table(['Line', 'File', 'Tag', 'Skipped because'], $skipped);
        }
        $io->{$skipped ? 'warning' : 'success'}(\sprintf('%s: %d, skipped: %d.', $dryRun ? 'Would import' : 'Imported', \count($imported), \count($skipped)));
        if ($dryRun) {
            $io->note('Dry run, nothing was written.');
        }

        return Command::SUCCESS;
    }

    /**
     * @param array<string, true> $seen checksum and item of every file handled in this run
     *
     * @return string|null why the row was skipped; null if it was (or in a dry run would be) imported
     */
    private function importRow(string $dir, string $file, string $tag, Attribute $attribute, User $admin, array &$seen, bool $dryRun): ?string
    {
        $path = '/' === ($file[0] ?? '') ? $file : $dir.'/'.$file;
        if (!is_file($path) || !is_readable($path)) {
            return 'file missing';
        }
        if (($normalized = Tag::normalize($tag)) === null) {
            return 'not a tag';
        }
        $items = $this->em->getRepository(TimberItem::class)->findBy(['tagNumber' => $normalized, 'voidedAt' => null]);
        if (1 !== \count($items)) {
            return $items ? 'tag is not unique' : 'unknown tag';
        }
        if (filesize($path) > PhotoStorage::MAX_BYTES) {
            return 'larger than 10 MB';
        }
        if (!$this->storage->isJpeg($path)) {
            return 'not a JPEG';
        }

        $item = $items[0];
        $sha256 = hash_file('sha256', $path);
        $key = $sha256.$item->id->toRfc4122();
        if (isset($seen[$key]) || $this->em->getRepository(Photo::class)->findOneBy(['sha256' => $sha256, 'timberItemId' => $item->id])) {
            return 'already imported';
        }
        $seen[$key] = true;
        if ($dryRun) {
            return null;
        }

        $photoId = Uuid::v7();
        $this->storage->store($photoId, $path);
        try {
            $this->em->wrapInTransaction(function () use ($photoId, $item, $admin, $attribute, $path, $sha256): void {
                $now = new \DateTimeImmutable();
                $this->em->persist(new Photo($photoId, $item->id, $admin, filesize($path), $sha256, $this->takenAt($path), $now));
                $this->em->persist(new TimberItemEvent(Uuid::v7(), $item->id, EventType::AttributeRecorded,
                    ['attribute_id' => $attribute->id->toRfc4122(), 'value' => $photoId->toRfc4122()], $now, $admin, receivedAt: $now));
                $this->em->flush();
                $this->projector->project($item->id);
            });
        } catch (\Throwable $e) {
            $this->storage->remove($photoId);
            throw $e;
        }

        return null;
    }

    private function takenAt(string $path): \DateTimeImmutable
    {
        // EXIF carries no time zone; the photos were taken in Leipzig. Falls back to the file date.
        $exif = \function_exists('exif_read_data') ? @exif_read_data($path, 'EXIF') : false;
        $taken = \is_array($exif) && \is_string($exif['DateTimeOriginal'] ?? null)
            ? \DateTimeImmutable::createFromFormat('!Y:m:d H:i:s', $exif['DateTimeOriginal'], new \DateTimeZone('Europe/Berlin'))
            : false;

        return $taken ?: (new \DateTimeImmutable('@'.filemtime($path)));
    }

    /**
     * @return array<int, array{string, string}> file and tag per CSV line number; empty with $error set if the CSV is unusable
     */
    private function readCsv(string $csv, ?string &$error): array
    {
        $handle = is_file($csv) ? fopen($csv, 'r') : false;
        if (!$handle) {
            $error = \sprintf('Cannot read "%s".', $csv);

            return [];
        }
        // The header decides the separator: Excel and Numbers write semicolons or commas depending on the locale.
        $header = preg_replace('/^\xEF\xBB\xBF/', '', (string) fgets($handle));
        $separator = array_find([',', ';'], static fn (string $separator) => ['file', 'tag'] === array_map('trim', str_getcsv($header, $separator, escape: '')));
        if (null === $separator) {
            $error = 'The first line must be the header "file,tag" or "file;tag".';

            return [];
        }
        $rows = [];
        $line = 1;
        while (false !== ($row = fgetcsv($handle, separator: $separator, escape: ''))) {
            ++$line;
            if ([null] !== $row) {
                $rows[$line] = [trim($row[0]), trim($row[1] ?? '')];
            }
        }
        fclose($handle);

        return $rows;
    }
}
