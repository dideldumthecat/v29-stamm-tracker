<?php

namespace App\Migration;

use App\Entity\Attribute;
use App\Entity\AttributeType;
use Doctrine\Migrations\AbstractMigration;
use Symfony\Component\Uid\Uuid;

/**
 * Base class for migrations that create or change system attributes (attributes with a key); they exist only in the database.
 * A migration reads like an entry of a configuration file:
 *
 *     $this->addAttribute(key: 'length', name: 'Länge', type: AttributeType::Choice, appliesTo: ['stem', 'beam'], inheritable: true, options: ['4,10 m']);
 *
 * Everything goes through addSql(), so --dry-run writes nothing. The attributes are read once and then tracked in memory,
 * so a call sees what the calls before it in the same migration did. Mistakes abort the migration before it changes anything.
 */
abstract class AttributeMigration extends AbstractMigration
{
    private const int STEP = 10;

    /** @var list<array{id: string, name: string, key: ?string, sort: int, options: array<string, int>}> */
    private ?array $attributes = null;

    protected function hasAttribute(string $key): bool
    {
        return null !== $this->find($key);
    }

    /**
     * New attributes go to the end of the order, their options keep the given order.
     *
     * @param list<string> $appliesTo  stem and/or beam
     * @param list<string> $options    only for type choice, at least one
     * @param list<string> $hiddenWhen keys of yes/no attributes
     */
    protected function addAttribute(
        string $key,
        string $name,
        AttributeType $type,
        array $appliesTo,
        bool $inheritable,
        bool $series = false,
        array $options = [],
        array $hiddenWhen = [],
        ?string $unit = null,
        string $description = '',
    ): void {
        $this->load();
        $this->abortIf(!Attribute::isValidKey($key), \sprintf('Invalid attribute key "%s".', $key));
        $this->abortIf($this->hasAttribute($key), \sprintf('An attribute with the key "%s" exists already.', $key));
        $this->abortIf([] === $appliesTo || array_diff($appliesTo, Attribute::KINDS), \sprintf('"%s": appliesTo must list %s.', $key, implode(' and/or ', Attribute::KINDS)));
        $this->abortIf(AttributeType::Choice === $type && [] === $options, \sprintf('"%s": a choice needs options.', $key));
        $this->abortIf(AttributeType::Choice !== $type && [] !== $options, \sprintf('"%s": only a choice has options.', $key));
        $this->abortIf(null !== $unit && AttributeType::Number !== $type, \sprintf('"%s": only a number has a unit.', $key));
        $this->abortIf(\count($options) !== \count(array_unique($options)), \sprintf('"%s": an option appears twice.', $key));
        $appliesTo = array_values(array_intersect(Attribute::KINDS, $appliesTo));
        sort($hiddenWhen);

        $id = Uuid::v7();
        $sort = max([0, ...array_column($this->attributes, 'sort')]) + self::STEP;
        $this->addSql(
            'INSERT INTO attributes (id, name, type, description, unit, is_series, is_inheritable, sort_order, active, `key`, applies_to, hidden_when) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
            [$id->toBinary(), $name, $type->value, $description, $unit, (int) $series, (int) $inheritable, $sort, $key, json_encode($appliesTo), json_encode($hiddenWhen)],
        );
        $this->attributes[] = ['id' => $id->toBinary(), 'name' => $name, 'key' => $key, 'sort' => $sort, 'options' => []];
        foreach ($options as $label) {
            $this->addOption($key, $label);
        }
    }

    /** Gives an existing attribute without a key its key; it is found by its exact name, which must be unique. */
    protected function assignKey(string $name, string $key): void
    {
        $this->load();
        $this->abortIf(!Attribute::isValidKey($key), \sprintf('Invalid attribute key "%s".', $key));
        $this->abortIf($this->hasAttribute($key), \sprintf('An attribute with the key "%s" exists already.', $key));
        $matches = array_keys(array_filter($this->attributes, static fn (array $a) => $a['name'] === $name));
        $this->abortIf(1 !== \count($matches), \sprintf('Cannot assign the key "%s": found %d attributes named "%s", expected exactly one.', $key, \count($matches), $name));
        $this->abortIf(null !== $this->attributes[$matches[0]]['key'], \sprintf('Cannot assign the key "%s": "%s" has the key "%s" already, a key never changes.', $key, $name, $this->attributes[$matches[0]]['key']));

        $this->addSql('UPDATE attributes SET `key` = ? WHERE id = ?', [$key, $this->attributes[$matches[0]]['id']]);
        $this->attributes[$matches[0]]['key'] = $key;
    }

    /** Appends an option to the end of a choice. */
    protected function addOption(string $key, string $label): void
    {
        $attribute = $this->attribute($key);
        $this->abortIf(isset($attribute['options'][$label]), \sprintf('"%s" has the option "%s" already.', $key, $label));
        $sort = max([0, ...$attribute['options']]) + self::STEP;
        $this->addSql('INSERT INTO attribute_options (id, label, sort_order, active, attribute_id) VALUES (?, ?, ?, 1, ?)', [Uuid::v7()->toBinary(), $label, $sort, $attribute['id']]);
        $this->attributes[$this->index($key)]['options'][$label] = $sort;
    }

    protected function renameOption(string $key, string $from, string $to): void
    {
        $attribute = $this->attribute($key);
        $this->abortIf(!isset($attribute['options'][$from]), \sprintf('"%s" has no option "%s".', $key, $from));
        $this->abortIf(isset($attribute['options'][$to]), \sprintf('"%s" has the option "%s" already.', $key, $to));
        $this->addSql('UPDATE attribute_options SET label = ? WHERE attribute_id = ? AND BINARY label = ?', [$to, $attribute['id'], $from]);
        $options = $attribute['options'];
        $options[$to] = $options[$from];
        unset($options[$from]);
        $this->attributes[$this->index($key)]['options'] = $options;
    }

    private function load(): void
    {
        if (null !== $this->attributes) {
            return;
        }
        $this->attributes = [];
        foreach ($this->connection->fetchAllAssociative('SELECT id, name, `key`, sort_order FROM attributes') as $row) {
            $this->attributes[] = ['id' => $row['id'], 'name' => $row['name'], 'key' => $row['key'], 'sort' => (int) $row['sort_order'], 'options' => []];
        }
        $byId = array_flip(array_column($this->attributes, 'id'));
        foreach ($this->connection->fetchAllAssociative('SELECT attribute_id, label, sort_order FROM attribute_options') as $row) {
            $this->attributes[$byId[$row['attribute_id']]]['options'][$row['label']] = (int) $row['sort_order'];
        }
    }

    private function find(string $key): ?int
    {
        $this->load();

        return array_find_key($this->attributes, static fn (array $a) => $a['key'] === $key);
    }

    private function index(string $key): int
    {
        $index = $this->find($key);
        $this->abortIf(null === $index, \sprintf('No attribute with the key "%s".', $key));

        return $index;
    }

    /** @return array{id: string, name: string, key: ?string, sort: int, options: array<string, int>} */
    private function attribute(string $key): array
    {
        return $this->attributes[$this->index($key)];
    }
}
