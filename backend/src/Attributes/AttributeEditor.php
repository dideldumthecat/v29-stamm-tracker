<?php

namespace App\Attributes;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\EventType;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Maintenance of attributes in the administration: GET/POST/PATCH/PUT /api/admin/attributes, see AdminAttribute in frontend/shared/contract.ts.
 * All rules live here. Attributes with a key (system attributes) are created and changed in migrations (App\Migration\AttributeMigration):
 * the administration may only change their name, description and order. Nothing is deleted, options are only deactivated.
 * No events: attributes are configuration.
 */
final class AttributeEditor
{
    private const array TYPES = [AttributeType::Choice, AttributeType::Boolean, AttributeType::Number, AttributeType::Text, AttributeType::Date, AttributeType::Month];
    private const array SERIES_TYPES = [AttributeType::Number, AttributeType::Text, AttributeType::Date, AttributeType::Month];
    private const int STEP = 10;
    /** What the administration may change on a system attribute (the order has its own call). */
    private const array SYSTEM_EDITABLE = ['name', 'description'];

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /** @return list<array<string, mixed>> */
    public function all(): array
    {
        $options = [];
        foreach ($this->em->getRepository(AttributeOption::class)->findBy([], ['sortOrder' => 'ASC']) as $option) {
            $options[$option->attribute->id->toRfc4122()][] = $option;
        }
        $withValues = array_flip($this->em->getConnection()->fetchFirstColumn(
            'SELECT DISTINCT JSON_VALUE(data, ?) FROM timber_item_events WHERE type = ?',
            ['$.attribute_id', EventType::AttributeRecorded->value],
        ));

        return array_map(
            static fn (Attribute $a) => self::view($a, $options[$a->id->toRfc4122()] ?? [], isset($withValues[$a->id->toRfc4122()])),
            $this->em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC']),
        );
    }

    /** @return array<string, mixed> */
    public function one(Attribute $attribute): array
    {
        return self::view($attribute, $this->options($attribute), $this->hasValues($attribute));
    }

    /**
     * @param array<mixed> $body
     *
     * @throws InvalidAttribute
     */
    public function create(array $body): Attribute
    {
        $in = $this->check(array_replace([
            'name' => '', 'description' => '', 'type' => null, 'unit' => null, 'is_series' => false, 'is_inheritable' => false,
            'applies_to' => Attribute::KINDS, 'hidden_when' => [], 'active' => true, 'options' => [],
        ], array_intersect_key($body, array_flip(['name', 'description', 'type', 'unit', 'is_series', 'is_inheritable', 'applies_to', 'hidden_when', 'active', 'options']))), null, []);

        $last = $this->em->getConnection()->fetchOne('SELECT MAX(sort_order) FROM attributes');
        $attribute = new Attribute($in['name'], $in['type'], $in['description'], $in['unit'], $in['is_series'], $in['is_inheritable'],
            (int) $last + self::STEP, $in['active'], appliesTo: $in['applies_to'], hiddenWhen: $in['hidden_when']);
        $this->em->persist($attribute);
        $this->syncOptions($attribute, $in, []);
        $this->em->flush();

        return $attribute;
    }

    /**
     * Fields missing in the body stay as they are; the options come as the complete list or not at all.
     *
     * @param array<mixed> $body
     *
     * @throws InvalidAttribute
     */
    public function update(Attribute $attribute, array $body): void
    {
        $options = $this->options($attribute);
        $current = [
            'name' => $attribute->name, 'description' => $attribute->description, 'type' => $attribute->type->value, 'unit' => $attribute->unit,
            'is_series' => $attribute->isSeries, 'is_inheritable' => $attribute->isInheritable, 'applies_to' => $attribute->appliesTo,
            'hidden_when' => $attribute->hiddenWhen, 'active' => $attribute->active,
            'options' => array_map(static fn (AttributeOption $o) => ['id' => $o->id->toRfc4122(), 'label' => $o->label, 'active' => $o->active], $options),
        ];
        if (null !== $attribute->key) {
            $this->refuseLockedFields($body, $current);
        }
        $in = $this->check(array_replace($current, array_intersect_key($body, $current)), $attribute, $options);

        $attribute->name = $in['name'];
        $attribute->description = $in['description'];
        $attribute->type = $in['type'];
        $attribute->unit = $in['unit'];
        $attribute->isSeries = $in['is_series'];
        $attribute->isInheritable = $in['is_inheritable'];
        $attribute->appliesTo = $in['applies_to'];
        $attribute->hiddenWhen = $in['hidden_when'];
        $attribute->active = $in['active'];
        $this->syncOptions($attribute, $in, $options);
        $this->em->flush();
    }

    /**
     * @param mixed $ids every attribute id, system attributes too, in the new order
     *
     * @throws InvalidAttribute
     */
    public function reorder(mixed $ids): void
    {
        $attributes = [];
        foreach ($this->em->getRepository(Attribute::class)->findAll() as $a) {
            $attributes[$a->id->toRfc4122()] = $a;
        }
        if (!\is_array($ids) || !array_is_list($ids) || array_filter($ids, static fn (mixed $id) => !\is_string($id)) || \count($ids) !== \count(array_unique($ids))
            || array_diff_key($attributes, array_flip($ids)) || array_diff($ids, array_keys($attributes))) {
            throw new InvalidAttribute([['field' => 'ids', 'message' => 'Die Reihenfolge muss jedes Merkmal genau einmal enthalten.']]);
        }
        foreach ($ids as $i => $id) {
            $attributes[$id]->sortOrder = self::STEP * ($i + 1);
        }
        $this->em->flush();
    }

    /**
     * A system attribute is only refused what differs: a client may send the whole form as long as the locked fields keep their value.
     *
     * @param array<mixed>         $body
     * @param array<string, mixed> $current
     *
     * @throws InvalidAttribute
     */
    private function refuseLockedFields(array $body, array $current): void
    {
        $errors = [];
        foreach (array_diff_key($current, array_flip(self::SYSTEM_EDITABLE)) as $field => $value) {
            if (!\array_key_exists($field, $body)) {
                continue;
            }
            $sent = $body[$field];
            if ('options' === $field && \is_array($sent)) {
                $sent = array_map(static fn (mixed $o) => \is_array($o) ? ['id' => $o['id'] ?? null, 'label' => $o['label'] ?? null, 'active' => $o['active'] ?? true] : $o, $sent);
            }
            if ($sent != $value) {
                $errors[] = ['field' => $field, 'message' => 'Bei Systemmerkmalen ist das im Code festgelegt.'];
            }
        }
        if ($errors) {
            throw new InvalidAttribute($errors);
        }
    }

    public function hasValues(Attribute $attribute): bool
    {
        // Voided events stay in the log, so recordings on voided items count too.
        return (bool) $this->em->getConnection()->fetchOne(
            'SELECT 1 FROM timber_item_events WHERE type = ? AND JSON_VALUE(data, ?) = ? LIMIT 1',
            [EventType::AttributeRecorded->value, '$.attribute_id', $attribute->id->toRfc4122()],
        );
    }

    /**
     * @param list<AttributeOption> $options
     *
     * @return array<string, mixed>
     */
    private static function view(Attribute $a, array $options, bool $hasValues): array
    {
        return [
            'id' => $a->id->toRfc4122(),
            'key' => $a->key,
            'name' => $a->name,
            'description' => $a->description,
            'type' => $a->type->value,
            'unit' => $a->unit,
            'is_series' => $a->isSeries,
            'is_inheritable' => $a->isInheritable,
            'applies_to' => $a->appliesTo,
            'hidden_when' => $a->hiddenWhen,
            'sort_order' => $a->sortOrder,
            'active' => $a->active,
            'options' => array_map(static fn (AttributeOption $o) => [
                'id' => $o->id->toRfc4122(), 'label' => $o->label, 'sort_order' => $o->sortOrder, 'active' => $o->active,
            ], $options),
            'is_system' => null !== $a->key,
            'has_values' => $hasValues,
        ];
    }

    /** @return list<AttributeOption> in order, inactive ones too */
    private function options(Attribute $attribute): array
    {
        return $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attribute], ['sortOrder' => 'ASC']);
    }

    /**
     * Checks the complete state the attribute will have and collects every violation.
     *
     * @param array<string, mixed>  $in      the state to check
     * @param list<AttributeOption> $options the existing options of $current
     *
     * @return array<string, mixed> the state with trimmed texts, the type as enum and the options as a list of label, active and optional id
     *
     * @throws InvalidAttribute
     */
    private function check(array $in, ?Attribute $current, array $options): array
    {
        $errors = [];
        $fail = static function (string $field, string $message) use (&$errors): void {
            $errors[] = ['field' => $field, 'message' => $message];
        };

        $name = \is_string($in['name']) ? trim($in['name']) : '';
        if ('' === $name) {
            $fail('name', 'Bitte einen Namen eingeben.');
        } elseif (mb_strlen($name) > 255) {
            $fail('name', 'Der Name darf höchstens 255 Zeichen lang sein.');
        } elseif ($this->nameTaken($name, $current)) {
            $fail('name', 'Ein Merkmal mit diesem Namen gibt es schon.');
        }

        $description = $in['description'];
        if (!\is_string($description)) {
            $fail('description', 'Die Beschreibung muss ein Text sein.');
            $description = '';
        }

        $type = \is_string($in['type']) ? AttributeType::tryFrom($in['type']) : null;
        if (!\in_array($type, self::TYPES, true)) {
            $fail('type', 'Bitte einen Typ wählen.');
            $type = null;
        }

        $unit = $in['unit'];
        if (null !== $unit && !\is_string($unit)) {
            $fail('unit', 'Die Einheit muss ein Text sein.');
            $unit = null;
        }
        $unit = null === $unit || '' === trim($unit) ? null : trim($unit);
        if (null !== $unit && null !== $type && AttributeType::Number !== $type) {
            $fail('unit', 'Eine Einheit gibt es nur bei Zahlen.');
        } elseif (null !== $unit && mb_strlen($unit) > 32) {
            $fail('unit', 'Die Einheit darf höchstens 32 Zeichen lang sein.');
        }

        $appliesTo = $in['applies_to'];
        if (!\is_array($appliesTo) || !array_is_list($appliesTo) || [] === $appliesTo || array_diff($appliesTo, Attribute::KINDS)) {
            $fail('applies_to', 'Bitte mindestens Stamm oder Balken wählen.');
            $appliesTo = [];
        }
        $appliesTo = array_values(array_intersect(Attribute::KINDS, $appliesTo));

        $hiddenWhen = $in['hidden_when'];
        if (!\is_array($hiddenWhen) || !array_is_list($hiddenWhen) || array_filter($hiddenWhen, static fn (mixed $key) => !\is_string($key))) {
            $fail('hidden_when', 'Die Bedingungen für das Ausblenden müssen eine Liste von Merkmalen sein.');
            $hiddenWhen = [];
        } elseif (array_diff($hiddenWhen, $this->yesNoKeys())) {
            $fail('hidden_when', 'Ausblenden ist nur bei Ja-Nein-Merkmalen mit Schlüssel möglich.');
        }
        $hiddenWhen = array_values(array_unique($hiddenWhen));
        sort($hiddenWhen);

        foreach (['is_series', 'is_inheritable', 'active'] as $flag) {
            if (!\is_bool($in[$flag])) {
                $fail($flag, 'Der Wert muss wahr oder falsch sein.');
                $in[$flag] = false;
            }
        }
        if ($in['is_series'] && null !== $type && !\in_array($type, self::SERIES_TYPES, true)) {
            $fail('is_series', 'Bei Auswahl und Ja/Nein gibt es keine Messreihe.');
        }

        if ($current && $this->hasValues($current)) {
            foreach ([['type', $type, $current->type], ['is_series', $in['is_series'], $current->isSeries], ['is_inheritable', $in['is_inheritable'], $current->isInheritable]] as [$field, $new, $old]) {
                if (null !== $new && $new !== $old) {
                    $fail($field, 'Das lässt sich nicht mehr ändern, weil schon Werte erfasst sind.');
                }
            }
        }

        $choices = [];
        if (AttributeType::Choice === $type) {
            $choices = $this->checkOptions($in['options'], $options, $fail);
        }

        if ($errors) {
            throw new InvalidAttribute($errors);
        }

        return [
            'name' => $name, 'description' => $description, 'type' => $type, 'unit' => $unit, 'is_series' => $in['is_series'],
            'is_inheritable' => $in['is_inheritable'], 'applies_to' => $appliesTo, 'hidden_when' => $hiddenWhen, 'active' => $in['active'], 'options' => $choices,
        ];
    }

    /**
     * @param list<AttributeOption>          $existing
     * @param callable(string, string): void $fail
     *
     * @return list<array{id: ?string, label: string, active: bool}>
     */
    private function checkOptions(mixed $list, array $existing, callable $fail): array
    {
        if (!\is_array($list) || !array_is_list($list)) {
            $fail('options', 'Die Auswahl-Optionen müssen eine Liste sein.');

            return [];
        }
        $known = [];
        foreach ($existing as $option) {
            $known[$option->id->toRfc4122()] = true;
        }
        $result = [];
        $labels = [];
        $seen = [];
        foreach ($list as $i => $option) {
            $label = \is_array($option) && \is_string($option['label'] ?? null) ? trim($option['label']) : '';
            $id = \is_array($option) ? ($option['id'] ?? null) : null;
            $active = \is_array($option) ? ($option['active'] ?? true) : true;
            if ('' === $label) {
                $fail("options.$i.label", 'Bitte einen Namen für die Auswahl-Option eingeben.');
            } elseif (mb_strlen($label) > 255) {
                $fail("options.$i.label", 'Der Name einer Auswahl-Option darf höchstens 255 Zeichen lang sein.');
            } elseif (isset($labels[mb_strtolower($label)])) {
                $fail("options.$i.label", \sprintf('Die Auswahl-Option „%s“ gibt es schon.', $label));
            }
            $labels[mb_strtolower($label)] = true;
            if (null !== $id && (!\is_string($id) || !isset($known[$id]) || isset($seen[$id]))) {
                $fail("options.$i.id", 'Diese Auswahl-Option gehört nicht zum Merkmal.');
            }
            if (\is_string($id)) {
                $seen[$id] = true;
            }
            if (!\is_bool($active)) {
                $fail("options.$i.active", 'Der Wert muss wahr oder falsch sein.');
                $active = true;
            }
            $result[] = ['id' => \is_string($id) ? $id : null, 'label' => $label, 'active' => $active];
        }
        if (array_diff_key($known, $seen)) {
            $fail('options', 'Bestehende Auswahl-Optionen dürfen nicht fehlen; sie lassen sich nur deaktivieren.');
        }
        if (!array_filter($result, static fn (array $o) => $o['active'])) {
            $fail('options', 'Bitte mindestens eine aktive Auswahl-Option anlegen.');
        }

        return $result;
    }

    /**
     * @param array<string, mixed>  $in       as returned by check()
     * @param list<AttributeOption> $existing
     */
    private function syncOptions(Attribute $attribute, array $in, array $existing): void
    {
        $byId = [];
        foreach ($existing as $option) {
            $byId[$option->id->toRfc4122()] = $option;
        }
        // Left a choice: its options stay (never deleted) but are no longer offered.
        $leftChoice = AttributeType::Choice !== $in['type'];
        foreach ($in['options'] as $i => $o) {
            $order = self::STEP * ($i + 1);
            if (null === $o['id']) {
                $this->em->persist(new AttributeOption($attribute, $o['label'], $order, $o['active']));
            } else {
                $option = $byId[$o['id']];
                [$option->label, $option->sortOrder, $option->active] = [$o['label'], $order, $o['active']];
            }
        }
        if ($leftChoice) {
            foreach ($existing as $option) {
                $option->active = false;
            }
        }
    }

    private function nameTaken(string $name, ?Attribute $current): bool
    {
        foreach ($this->em->getRepository(Attribute::class)->findAll() as $other) {
            if ($other !== $current && mb_strtolower($other->name) === mb_strtolower($name)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    private function yesNoKeys(): array
    {
        return array_values(array_filter(array_map(
            static fn (Attribute $a) => AttributeType::Boolean === $a->type ? $a->key : null,
            $this->em->getRepository(Attribute::class)->findAll(),
        )));
    }
}
