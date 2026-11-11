<?php

namespace App\Command;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use App\Projection\TimberItemProjector;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

/**
 * Attributes are matched by key if the entry has one (so a changed name renames), else by name; options by label.
 * Never recreated: events reference their ids. Nothing is ever deleted; what is missing from the file stays as it is.
 */
#[AsCommand(name: 'app:attributes:import', description: 'Create or update attributes and their options from a YAML file, see data/attributes.example.yaml')]
class AttributesImportCommand
{
    private const array KEYS = ['key', 'name', 'description', 'type', 'unit', 'is_series', 'is_inheritable', 'applies_to', 'hidden_when', 'active', 'options'];

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemProjector $projector,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'YAML file with the attributes')] string $file,
        #[Option(description: 'Show what would change without writing anything')] bool $dryRun = false,
    ): int {
        try {
            $entries = Yaml::parseFile($file);
        } catch (ParseException $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }

        $errors = [];
        $attributes = \is_array($entries) && array_is_list($entries) ? $this->normalize($entries, $errors) : [];
        if (!\is_array($entries) || !array_is_list($entries)) {
            $errors[] = 'The file must contain a list of attributes.';
        }
        $existing = $this->em->getRepository(Attribute::class)->findAll();
        $matches = $this->match($attributes, $existing, $errors);
        foreach ($attributes as $name => $a) {
            $current = $matches[$name] ?? null;
            if ($current && $current->type !== $a['type'] && $this->hasEvents($current)) {
                $errors[] = \sprintf('"%s": type cannot change from %s to %s, values have already been recorded.', $name, $current->type->value, $a['type']->value);
            }
        }
        $this->checkHiddenWhen($attributes, $existing, $matches, $errors);
        if ($errors) {
            $io->error(['Nothing imported.', ...$errors]);

            return Command::FAILURE;
        }

        $run = function () use ($io, $attributes, $existing, $matches, $dryRun): void {
            $rebuild = false;
            foreach ($attributes as $name => $a) {
                $attribute = $matches[$name] ?? null;
                if (!$attribute) {
                    $attribute = new Attribute($name, $a['type'], $a['description'], $a['unit'], $a['is_series'], $a['is_inheritable'], $a['sort_order'], $a['active'], key: $a['key'], appliesTo: $a['applies_to'], hiddenWhen: $a['hidden_when']);
                    $this->persist($attribute, $dryRun);
                    foreach ($a['options'] as $label => $o) {
                        $this->persist(new AttributeOption($attribute, $label, $o['sort_order'], $o['active']), $dryRun);
                    }
                    $io->writeln("created    $name");
                    continue;
                }

                $renamed = $attribute->name !== $name;
                if ($renamed) {
                    $io->writeln("renamed    {$attribute->name} → $name");
                }
                $changes = $this->apply($attribute, [
                    'name' => $name,
                    'type' => $a['type'], 'description' => $a['description'], 'unit' => $a['unit'], 'isSeries' => $a['is_series'],
                    'isInheritable' => $a['is_inheritable'], 'appliesTo' => $a['applies_to'], 'hiddenWhen' => $a['hidden_when'], 'sortOrder' => $a['sort_order'], 'active' => $a['active'],
                ], $dryRun);
                $changes = array_values(array_diff($changes, ['name']));
                if ($a['key'] && null === $attribute->key) {
                    $changes[] = 'key';
                    if (!$dryRun) {
                        $attribute->assignKey($a['key']);
                    }
                }
                // Both decide how events turn into projected values.
                $rebuild = $rebuild || array_intersect($changes, ['isSeries', 'isInheritable']);

                $options = [];
                foreach ($this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attribute]) as $option) {
                    $options[$option->label] = $option;
                }
                foreach ($a['options'] as $label => $o) {
                    if (!isset($options[$label])) {
                        $this->persist(new AttributeOption($attribute, $label, $o['sort_order'], $o['active']), $dryRun);
                        $changes[] = "new option $label";
                    } elseif ($this->apply($options[$label], ['sortOrder' => $o['sort_order'], 'active' => $o['active']], $dryRun)) {
                        $changes[] = "option $label";
                    }
                }
                if ($changes) {
                    $io->writeln("updated    $name (".implode(', ', $changes).')');
                } elseif (!$renamed) {
                    $io->writeln("unchanged  $name");
                }
                foreach (array_diff_key($options, $a['options']) as $label => $option) {
                    $io->writeln("           option not in file: $label");
                }
            }
            foreach (array_udiff($existing, $matches, static fn (Attribute $x, Attribute $y) => $x->id <=> $y->id) as $attribute) {
                $io->writeln("not in file  {$attribute->name}");
            }

            if (!$dryRun) {
                $this->em->flush();
                if ($rebuild) {
                    $io->writeln(\sprintf('Rebuilt projections of %d timber items.', $this->projector->rebuildAll()));
                }
            }
        };

        if ($dryRun) {
            $run();
            $io->note('Dry run, nothing was written.');
        } else {
            $this->em->wrapInTransaction($run);
            $io->success('Imported.');
        }

        return Command::SUCCESS;
    }

    /**
     * Finds the existing attribute for each entry: by key, else by name. Entries with no match are created.
     *
     * @param array<string, array<string, mixed>> $attributes by name
     * @param list<Attribute>                     $existing
     * @param list<string>                        $errors
     *
     * @return array<string, Attribute> by name in the file
     */
    private function match(array $attributes, array $existing, array &$errors): array
    {
        $matches = [];
        foreach ($attributes as $name => $a) {
            $byKey = $a['key'] ? array_find($existing, static fn (Attribute $e) => $e->key === $a['key']) : null;
            $byName = array_find($existing, static fn (Attribute $e) => $e->name === $name);
            $match = $byKey ?? $byName;
            if ($match && $a['key'] && null !== $match->key && $match->key !== $a['key']) {
                $errors[] = \sprintf('"%s": key cannot change from %s to %s.', $name, $match->key, $a['key']);
            } elseif ($byKey && $byName && $byKey !== $byName) {
                $errors[] = \sprintf('"%s": the name belongs to another attribute than the key %s.', $name, $a['key']);
            } elseif ($match && \in_array($match, $matches, true)) {
                $errors[] = \sprintf('"%s": matches the same attribute as another entry.', $name);
            } elseif ($match) {
                $matches[$name] = $match;
            }
        }

        return $matches;
    }

    /**
     * Every key in hidden_when must name a yes/no attribute other than the entry itself. The file counts before the database:
     * it is what the attributes will be after the import.
     *
     * @param array<string, array<string, mixed>> $attributes by name
     * @param list<Attribute>                     $existing
     * @param array<string, Attribute>            $matches    by name in the file
     * @param list<string>                        $errors
     */
    private function checkHiddenWhen(array $attributes, array $existing, array $matches, array &$errors): void
    {
        $types = [];
        foreach ($existing as $attribute) {
            if (null !== $attribute->key) {
                $types[$attribute->key] = $attribute->type;
            }
        }
        $keys = [];
        foreach ($attributes as $name => $a) {
            $keys[$name] = $a['key'] ?? ($matches[$name] ?? null)?->key;
            if (null !== $keys[$name]) {
                $types[$keys[$name]] = $a['type'];
            }
        }
        foreach ($attributes as $name => $a) {
            foreach ($a['hidden_when'] as $key) {
                if ($key === $keys[$name]) {
                    $errors[] = \sprintf('"%s": hidden_when must not name the attribute itself (%s).', $name, $key);
                } elseif (!isset($types[$key])) {
                    $errors[] = \sprintf('"%s": hidden_when names the unknown key %s.', $name, $key);
                } elseif (AttributeType::Boolean !== $types[$key]) {
                    $errors[] = \sprintf('"%s": hidden_when names %s, which is of type %s, not boolean.', $name, $key, $types[$key]->value);
                }
            }
        }
    }

    /**
     * @param array<string, mixed> $values by property name
     *
     * @return list<string> names of the properties that differ; set on the entity unless $dryRun
     */
    private function apply(object $entity, array $values, bool $dryRun): array
    {
        $changes = [];
        foreach ($values as $property => $value) {
            if ($entity->$property !== $value) {
                $changes[] = $property;
                if (!$dryRun) {
                    $entity->$property = $value;
                }
            }
        }

        return $changes;
    }

    private function persist(object $entity, bool $dryRun): void
    {
        if (!$dryRun) {
            $this->em->persist($entity);
        }
    }

    private function hasEvents(Attribute $attribute): bool
    {
        return (bool) $this->em->getConnection()->fetchOne(
            'SELECT 1 FROM timber_item_events WHERE type = ? AND JSON_VALUE(data, ?) = ? LIMIT 1',
            [EventType::AttributeRecorded->value, '$.attribute_id', $attribute->id->toRfc4122()],
        );
    }

    /**
     * Applies defaults (none for is_series, is_inheritable, applies_to and hidden_when) and checks every entry, collecting all errors instead of stopping at the first.
     *
     * @param array<mixed> $entries as read from the YAML file
     * @param list<string> $errors
     *
     * @return array<string, array<string, mixed>> attributes by name, options by label
     */
    private function normalize(array $entries, array &$errors): array
    {
        $attributes = [];
        foreach ($entries as $i => $entry) {
            $label = \is_array($entry) && \is_string($entry['name'] ?? null) ? '"'.$entry['name'].'"' : 'Attribute #'.($i + 1);
            $fail = static function (string $message) use (&$errors, $label): void {
                $errors[] = "$label: $message";
            };
            if (!\is_array($entry) || array_is_list($entry)) {
                $fail('must be a map of keys like name and type.');
                continue;
            }
            if ($unknown = array_diff(array_keys($entry), self::KEYS)) {
                $fail('unknown key '.implode(', ', $unknown).'.');
            }

            $name = \is_string($entry['name'] ?? null) ? trim($entry['name']) : '';
            if ('' === $name) {
                $fail('name is missing or not a text.');
            } elseif (isset($attributes[$name])) {
                $fail('name appears more than once.');
            }
            $attributeKey = $entry['key'] ?? null;
            if (null !== $attributeKey && (!\is_string($attributeKey) || !Attribute::isValidKey($attributeKey))) {
                $fail(\sprintf('key must be lowercase letters, digits and underscores, starting with a letter, at most %d characters.', Attribute::KEY_MAX_LENGTH));
                $attributeKey = null;
            } elseif (null !== $attributeKey && \in_array($attributeKey, array_column($attributes, 'key'), true)) {
                $fail('key appears more than once.');
            }
            $type = \is_string($entry['type'] ?? null) ? AttributeType::tryFrom($entry['type']) : null;
            if (!$type) {
                $fail(\sprintf('type must be one of %s.', implode(', ', array_column(AttributeType::cases(), 'value'))));
            }
            foreach (['description', 'unit'] as $key) {
                if (isset($entry[$key]) && !\is_string($entry[$key])) {
                    $fail("$key must be a text (put numbers in quotes).");
                }
            }
            foreach (['is_series', 'is_inheritable', 'active'] as $key) {
                if (isset($entry[$key]) && !\is_bool($entry[$key])) {
                    $fail("$key must be true or false.");
                }
            }
            // No defaults: a forgotten line would silently change inheritance or where the app offers the field.
            foreach (['is_series', 'is_inheritable', 'applies_to', 'hidden_when'] as $key) {
                if (!isset($entry[$key])) {
                    $fail("$key is missing.");
                }
            }
            $appliesTo = $entry['applies_to'] ?? null;
            if (null !== $appliesTo && (!\is_array($appliesTo) || !array_is_list($appliesTo) || [] === $appliesTo
                || array_diff($appliesTo, Attribute::KINDS) || \count($appliesTo) !== \count(array_unique($appliesTo)))) {
                $fail(\sprintf('applies_to must be a list of %s, at least one, each only once.', implode(' and/or ', Attribute::KINDS)));
                $appliesTo = null;
            }
            $hiddenWhen = $entry['hidden_when'] ?? [];
            if (!\is_array($hiddenWhen) || !array_is_list($hiddenWhen) || array_filter($hiddenWhen, static fn (mixed $key) => !\is_string($key))
                || \count($hiddenWhen) !== \count(array_unique($hiddenWhen))) {
                $fail('hidden_when must be a list of attribute keys (may be empty), each only once.');
                $hiddenWhen = [];
            }
            // Sorted, so the same keys in another order are no change.
            sort($hiddenWhen);
            // Every photo counts and none replaces another (T11); only a series keeps all recordings.
            if (AttributeType::Photo === $type && !($entry['is_series'] ?? false)) {
                $fail('type photo needs is_series: true.');
            }
            if (isset($entry['unit']) && AttributeType::Number !== $type) {
                $fail('unit is only allowed for type number.');
            }

            $options = [];
            if (AttributeType::Choice === $type && !($entry['options'] ?? null)) {
                $fail('type choice needs options.');
            } elseif (AttributeType::Choice !== $type && isset($entry['options'])) {
                $fail('options are only allowed for type choice.');
            } elseif (isset($entry['options'])) {
                foreach (\is_array($entry['options']) && array_is_list($entry['options']) ? $entry['options'] : [null] as $j => $option) {
                    $option = \is_string($option) ? ['label' => $option] : $option;
                    $optionLabel = \is_array($option) && \is_string($option['label'] ?? null) ? trim($option['label']) : '';
                    if ('' === $optionLabel || array_diff(array_keys($option), ['label', 'active']) || !\is_bool($option['active'] ?? true)) {
                        $fail(\sprintf('option #%d must be a text or { label: …, active: false }.', $j + 1));
                    } elseif (isset($options[$optionLabel])) {
                        $fail("option \"$optionLabel\" appears more than once.");
                    } else {
                        $options[$optionLabel] = ['sort_order' => 10 * (\count($options) + 1), 'active' => $option['active'] ?? true];
                    }
                }
            }

            if ('' !== $name && $type) {
                $attributes[$name] = [
                    'key' => $attributeKey,
                    'type' => $type,
                    'description' => $entry['description'] ?? '',
                    'unit' => $entry['unit'] ?? null,
                    'is_series' => $entry['is_series'] ?? false,
                    'is_inheritable' => $entry['is_inheritable'] ?? false,
                    // Canonical order, so the same kinds in another order are no change.
                    'applies_to' => array_values(array_intersect(Attribute::KINDS, $appliesTo ?? [])),
                    'hidden_when' => $hiddenWhen,
                    'active' => $entry['active'] ?? true,
                    'sort_order' => 10 * ($i + 1),
                    'options' => $options,
                ];
            }
        }

        return $attributes;
    }
}
