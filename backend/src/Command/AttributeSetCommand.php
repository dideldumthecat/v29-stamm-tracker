<?php

namespace App\Command;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Entity\TimberItem;
use App\Entity\TimberItemEvent;
use App\Entity\TimberItemState;
use App\Entity\User;
use App\Entity\UserRole;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Uid\Uuid;

/**
 * Sets one attribute on many stems as ordinary attribute_recorded events (T03), for changes V29 wants "for all stems".
 * Beams are never touched: they inherit (T10), which is why only inheritable attributes are allowed.
 * Everything is validated before the first event is written and the events go in one transaction.
 */
#[AsCommand(name: 'app:attribute:set', description: 'Set an attribute value on many stems at once (only where no value is set, unless --overwrite)')]
class AttributeSetCommand
{
    private const MAX_TAG_NUMBER = 1999;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Exact attribute name, e.g. Länge')] string $attribute,
        #[Argument(description: 'Option text for choices (e.g. "4,10 m"), 34,5 for numbers, ja/nein for booleans, JJJJ-MM for months')] string $value,
        #[Option(description: 'Stems to change: all, 119, 1-10 or a list like 1-10,15,20-25 (leading zeros do not matter)')] ?string $range = null,
        #[Option(description: 'Also replace a different value that is already set')] bool $overwrite = false,
        #[Option(description: 'Show what would happen without writing anything')] bool $dryRun = false,
        #[Option(description: 'Name or ID of the user the values are recorded under; default: the only admin')] ?string $user = null,
    ): int {
        $numbers = null === $range ? null : $this->parseRange($range);
        // The database compares names case-insensitively; "exact" is checked here.
        $attr = array_find($this->em->getRepository(Attribute::class)->findBy(['name' => $attribute]), static fn (Attribute $a) => $a->name === $attribute);
        $error = match (true) {
            null === $range => '--range is required: all, a number, from-to or a list like 1-10,15.',
            false === $numbers => \sprintf('"%s" is not a range. Use all, 119, 1-10 or 1-10,15,20-25 (numbers 1 to %d).', $range, self::MAX_TAG_NUMBER),
            null === $attr => \sprintf('No attribute named "%s".', $attribute),
            !$attr->active => \sprintf('Attribute "%s" is inactive.', $attribute),
            $attr->isSeries || !$attr->isInheritable => \sprintf('"%s" is %s; only inheritable attributes that are not a series can be set for many stems.', $attribute, $attr->isSeries ? 'a series' : 'not inheritable'),
            default => null,
        };
        $parsed = $error ?? $this->parseValue($attr, $value, $error);
        $users = $this->em->getRepository(User::class)->findBy(null === $user ? ['role' => UserRole::Admin, 'revokedAt' => null] : ['revokedAt' => null]);
        $users = null === $user ? $users : array_values(array_filter($users, static fn (User $u) => $u->name === $user || $u->id->toRfc4122() === $user));
        $error ??= 1 !== \count($users) ? (null === $user
            ? 'The values are recorded under the admin, but there are '.($users ? 'several' : 'none').'. Choose one with --user (name or ID, see app:user:list).'
            : \sprintf('No active user "%s" found, or the name is not unique. Use the ID from app:user:list.', $user)) : null;
        if (null !== $error) {
            $io->error($error);

            return Command::FAILURE;
        }

        $labels = [];
        if (AttributeType::Choice === $attr->type) {
            foreach ($this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attr]) as $option) {
                $labels[$option->id->toRfc4122()] = $option->label;
            }
        }
        $show = fn (mixed $v) => match (true) {
            \is_bool($v) => $v ? 'ja' : 'nein',
            \is_float($v) || \is_int($v) => str_replace('.', ',', (string) $v),
            default => $labels[$v] ?? (string) $v,
        };

        $stems = [];
        foreach ($this->em->getRepository(TimberItem::class)->findBy(['parentId' => null, 'voidedAt' => null]) as $stem) {
            if (null !== $stem->tagNumber) {
                $stems[(int) $stem->tagNumber] = $stem;
            }
        }
        $current = [];
        foreach ($this->em->getRepository(TimberItemState::class)->findBy(['attributeId' => $attr->id]) as $state) {
            $current[$state->timberItemId->toRfc4122()] = $state->valueRecords[array_key_last($state->valueRecords)]['value'];
        }

        $set = [];
        $replaced = [];
        $missing = [];
        $skipped = 0;
        foreach ($numbers ?? array_keys($stems) as $number) {
            $stem = $stems[$number] ?? null;
            $old = $stem ? $current[$stem->id->toRfc4122()] ?? null : null;
            if (null === $stem) {
                $missing[] = $number;
            } elseif (null === $old) {
                $set[$number] = $stem;
            } elseif ($overwrite && $old != $parsed) {
                $set[$number] = $stem;
                $replaced[] = \sprintf('%d: %s → %s', $number, $show($old), $show($parsed));
            } else {
                ++$skipped;
            }
        }

        if (!$dryRun) {
            $this->em->wrapInTransaction(function () use ($set, $attr, $parsed, $users): void {
                $now = new \DateTimeImmutable();
                foreach ($set as $stem) {
                    $this->em->persist(new TimberItemEvent(Uuid::v7(), $stem->id, EventType::AttributeRecorded,
                        ['attribute_id' => $attr->id->toRfc4122(), 'value' => $parsed], $now, $users[0], receivedAt: $now));
                }
                $this->em->flush();
                foreach ($set as $stem) {
                    $this->projector->project($stem->id);
                }
            });
        }

        if ($replaced) {
            $io->section('Replaced values (number: old → new)');
            $io->listing($replaced);
        }
        if ($missing) {
            $io->warning(\sprintf('No stem with these numbers: %s.', implode(', ', $missing)));
        }
        $io->success(\sprintf('%s: %d, skipped (value already set): %d, no stem found: %d.', $dryRun ? 'Would set' : 'Set', \count($set), $skipped, \count($missing)));
        if ($dryRun) {
            $io->note('Dry run, nothing was written.');
        }

        return Command::SUCCESS;
    }

    /**
     * @return list<int>|false|null the requested tag numbers, null for "all", false if the text is not a range
     */
    private function parseRange(string $range): array|false|null
    {
        if ('all' === $range) {
            return null;
        }
        $numbers = [];
        foreach (explode(',', $range) as $part) {
            if (!preg_match('/^\s*0*(\d+)\s*(?:-\s*0*(\d+)\s*)?$/', $part, $m)) {
                return false;
            }
            [$from, $to] = [(int) $m[1], (int) ($m[2] ?? $m[1])];
            if ($from < 1 || $from > $to || $to > self::MAX_TAG_NUMBER) {
                return false;
            }
            array_push($numbers, ...range($from, $to));
        }

        return array_values(array_unique($numbers));
    }

    /**
     * Parses like the app saves the value (parseNumber and the option ids in attributeDraft.ts).
     *
     * @param string|null $error set to the reason if the text does not fit the attribute type
     */
    private function parseValue(Attribute $attribute, string $text, ?string &$error): bool|int|float|string|null
    {
        $text = trim($text);
        $fail = static function (string $reason) use (&$error): null {
            $error = $reason;

            return null;
        };

        return match ($attribute->type) {
            AttributeType::Choice => $this->optionId($attribute, $text) ?? $fail(\sprintf('"%s" is not an option of "%s". Valid options: %s.', $text, $attribute->name,
                implode(', ', array_map(static fn (AttributeOption $o) => $o->label, $this->options($attribute))))),
            AttributeType::Number => preg_match('/^-?\d+([.,]\d+)?$/', $text) ? 0 + str_replace(',', '.', $text) : $fail('The value must be a number such as 34,5.'),
            AttributeType::Boolean => match (strtolower($text)) {
                'ja', 'true' => true,
                'nein', 'false' => false,
                default => $fail('The value must be ja or nein.'),
            },
            AttributeType::Month => (\DateTimeImmutable::createFromFormat('!Y-m', $text) ?: null)?->format('Y-m') === $text ? $text : $fail('The value must be a month like 2026-10.'),
            default => $fail(\sprintf('Attributes of type %s cannot be set with this command.', $attribute->type->value)),
        };
    }

    private function optionId(Attribute $attribute, string $label): ?string
    {
        $option = array_find($this->options($attribute), static fn (AttributeOption $o) => $o->label === $label);

        return $option?->id->toRfc4122();
    }

    /**
     * @return list<AttributeOption>
     */
    private function options(Attribute $attribute): array
    {
        return $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attribute, 'active' => true], ['sortOrder' => 'ASC']);
    }
}
