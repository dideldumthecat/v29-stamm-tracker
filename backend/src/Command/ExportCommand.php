<?php

namespace App\Command;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\TimberItem;
use App\Entity\TimberItemState;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\AutoFilter;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

/**
 * Current state as Excel, one row per stem or beam. Reads the projections, the same ones the snapshot is built from,
 * so the file shows what the apps show after a sync. The headings are German: they are content for V29.
 */
#[AsCommand(name: 'app:export', description: 'Write all stems and beams (current state, without voided) to an Excel file')]
class ExportCommand
{
    /** As TAG_DIGITS in frontend/src/config/constants.ts. */
    private const TAG_DIGITS = 5;
    private const SERIES_SEPARATOR = ' | ';
    private const FIXED_COLUMNS = ['Kennung', 'Typ', 'Stamm', 'Angelegt am', 'Angelegt von', 'Zuletzt geändert am'];

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Target file; default stamm-tracker-export-YYYY-MM-DD-HHMM.xlsx (Berlin time) in the current directory')] ?string $file = null,
    ): int {
        $berlin = new \DateTimeZone('Europe/Berlin');
        $file ??= \sprintf('%s/stamm-tracker-export-%s.xlsx', getcwd(), (new \DateTimeImmutable('now', $berlin))->format('Y-m-d-Hi'));

        $items = $this->em->getRepository(TimberItem::class)->findBy(['voidedAt' => null]);
        $values = [];
        foreach ($this->em->getRepository(TimberItemState::class)->findAll() as $state) {
            $values[$state->timberItemId->toRfc4122()][$state->attributeId->toRfc4122()] = $state->valueRecords;
        }
        $attributes = array_values(array_filter(
            $this->em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC']),
            static fn (Attribute $attribute) => $attribute->active
                || array_any($values, static fn (array $own) => isset($own[$attribute->id->toRfc4122()])),
        ));
        $options = [];
        foreach ($this->em->getRepository(AttributeOption::class)->findAll() as $option) {
            $options[$option->id->toRfc4122()] = $option->label;
        }
        $users = [];
        foreach ($this->em->getRepository(User::class)->findAll() as $user) {
            $users[$user->id->toRfc4122()] = $user->name;
        }
        // Own events only: a beam does not show a later change of a value inherited from its stem.
        $changed = [];
        foreach ($this->em->getConnection()->fetchAllNumeric('SELECT timber_item_id, MAX(received_at) FROM timber_item_events GROUP BY timber_item_id') as [$itemId, $receivedAt]) {
            $changed[Uuid::fromBinary($itemId)->toRfc4122()] = $receivedAt;
        }

        $tags = [];
        foreach ($items as $item) {
            $tags[$item->id->toRfc4122()] = $item->tagNumber;
        }
        // Stems by number, each followed by its beams; items without a tag last.
        $sortKey = static function (TimberItem $item) use ($tags): array {
            $stemTag = $item->parentId ? ($tags[$item->parentId->toRfc4122()] ?? null) : $item->tagNumber;

            return [null === $stemTag ? \PHP_INT_MAX : (int) $stemTag, null !== $item->parentId, $item->tagNumber ?? '', $item->createdAt];
        };
        usort($items, static fn (TimberItem $a, TimberItem $b) => $sortKey($a) <=> $sortKey($b));

        $bold = new Style(fontBold: true);
        $dateStyle = new Style(format: 'dd.mm.yyyy');
        $dateTimeStyle = new Style(format: 'dd.mm.yyyy hh:mm');
        $dateTime = static fn (\DateTimeInterface $time) => Cell::fromValue($time->setTimezone($berlin), $dateTimeStyle);
        $utc = new \DateTimeZone('UTC');

        $headings = [...self::FIXED_COLUMNS, ...array_map(static fn (Attribute $attribute) => $attribute->name, $attributes)];
        $rows = [new Row(array_map(static fn (string $heading) => Cell::fromValue($heading, $bold), $headings))];
        foreach ($items as $item) {
            $id = $item->id->toRfc4122();
            $cells = [
                Cell::fromValue($this->formatTag($item->tagNumber)),
                Cell::fromValue($item->parentId ? 'Balken' : 'Stamm'),
                Cell::fromValue($item->parentId ? $this->formatTag($tags[$item->parentId->toRfc4122()] ?? null) : null),
                $dateTime($item->createdAt),
                Cell::fromValue($users[$item->createdBy->toRfc4122()] ?? null),
                isset($changed[$id]) ? $dateTime(new \DateTimeImmutable($changed[$id], $utc)) : Cell::fromValue(null),
            ];
            foreach ($attributes as $attribute) {
                $records = $values[$id][$attribute->id->toRfc4122()] ?? [];
                $cells[] = match (true) {
                    [] === $records => Cell::fromValue(null),
                    $attribute->isSeries => Cell::fromValue(implode(self::SERIES_SEPARATOR, array_map(fn (array $record) => $this->text($attribute, $record['value'], $options), $records))),
                    AttributeType::Number === $attribute->type => Cell::fromValue($records[0]['value']),
                    // Midnight as written, no time zone shift: the cell shows a date, not a point in time.
                    AttributeType::Date === $attribute->type => Cell::fromValue(new \DateTimeImmutable($records[0]['value']), $dateStyle),
                    default => Cell::fromValue($this->text($attribute, $records[0]['value'], $options)),
                };
            }
            $rows[] = new Row($cells);
        }

        $writer = new Writer();
        $writer->openToFile($file);
        $sheet = $writer->getCurrentSheet();
        $sheet->setName('Stämme und Balken');
        $sheet->setSheetView(new SheetView(freezeRow: 2));
        $sheet->setAutoFilter(new AutoFilter(0, 1, \count($headings) - 1, \count($rows)));
        $writer->addRows($rows);
        $writer->close();

        $io->success(\sprintf('%s: %d rows.', $file, \count($rows) - 1));

        return Command::SUCCESS;
    }

    /** "123-A" → "00123-A", as on the plaque. */
    private function formatTag(?string $tag): ?string
    {
        return null === $tag ? null : preg_replace_callback('/^\d+/', static fn (array $match) => str_pad($match[0], self::TAG_DIGITS, '0', \STR_PAD_LEFT), $tag);
    }

    /** @param array<string, string> $options option label by id */
    private function text(Attribute $attribute, bool|int|float|string $value, array $options): string
    {
        return match ($attribute->type) {
            AttributeType::Boolean => $value ? 'ja' : 'nein',
            AttributeType::Choice => $options[$value] ?? (string) $value,
            AttributeType::Date => (new \DateTimeImmutable((string) $value))->format('d.m.Y'),
            default => (string) $value,
        };
    }
}
