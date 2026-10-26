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
 * Attributes are matched by name and options by label, never recreated: events reference their ids.
 * Nothing is ever deleted; what is missing from the file stays as it is.
 */
#[AsCommand(name: 'app:attributes:import', description: 'Create or update attributes and their options from a YAML file, see data/attributes.example.yaml')]
class AttributesImportCommand
{
    private const array KEYS = ['name', 'description', 'type', 'unit', 'is_series', 'is_inheritable', 'active', 'options'];

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
        $existing = [];
        foreach ($this->em->getRepository(Attribute::class)->findAll() as $attribute) {
            $existing[$attribute->name] = $attribute;
        }
        foreach ($attributes as $name => $a) {
            $current = $existing[$name] ?? null;
            if ($current && $current->type !== $a['type'] && $this->hasEvents($current)) {
                $errors[] = \sprintf('"%s": type cannot change from %s to %s, values have already been recorded.', $name, $current->type->value, $a['type']->value);
            }
        }
        if ($errors) {
            $io->error(['Nothing imported.', ...$errors]);

            return Command::FAILURE;
        }

        $run = function () use ($io, $attributes, $existing, $dryRun): void {
            $rebuild = false;
            foreach ($attributes as $name => $a) {
                $attribute = $existing[$name] ?? null;
                if (!$attribute) {
                    $attribute = new Attribute($name, $a['type'], $a['description'], $a['unit'], $a['is_series'], $a['is_inheritable'], $a['sort_order'], $a['active']);
                    $this->persist($attribute, $dryRun);
                    foreach ($a['options'] as $label => $o) {
                        $this->persist(new AttributeOption($attribute, $label, $o['sort_order'], $o['active']), $dryRun);
                    }
                    $io->writeln("created    $name");
                    continue;
                }

                $changes = $this->apply($attribute, [
                    'type' => $a['type'], 'description' => $a['description'], 'unit' => $a['unit'], 'isSeries' => $a['is_series'],
                    'isInheritable' => $a['is_inheritable'], 'sortOrder' => $a['sort_order'], 'active' => $a['active'],
                ], $dryRun);
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
                $io->writeln($changes ? "updated    $name (".implode(', ', $changes).')' : "unchanged  $name");
                foreach (array_diff_key($options, $a['options']) as $label => $option) {
                    $io->writeln("           option not in file: $label");
                }
            }
            foreach (array_diff_key($existing, $attributes) as $name => $attribute) {
                $io->writeln("not in file  $name");
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
     * Applies defaults and checks every entry, collecting all errors instead of stopping at the first.
     *
     * @return array<string, array> attributes by name, options by label
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
                    'type' => $type,
                    'description' => $entry['description'] ?? '',
                    'unit' => $entry['unit'] ?? null,
                    'is_series' => $entry['is_series'] ?? false,
                    'is_inheritable' => $entry['is_inheritable'] ?? false,
                    'active' => $entry['active'] ?? true,
                    'sort_order' => 10 * ($i + 1),
                    'options' => $options,
                ];
            }
        }

        return $attributes;
    }
}
