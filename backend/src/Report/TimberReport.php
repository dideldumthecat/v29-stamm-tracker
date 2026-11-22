<?php

namespace App\Report;

use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Entity\TimberItem;
use App\Entity\TimberItemState;
use App\Entity\User;
use App\KeyFigures\KeyFigures;
use App\KeyFigures\MeasureReader;
use App\KeyFigures\Measures;
use App\KeyFigures\StemFigures;
use App\KeyFigures\StemPieces;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * The export for V29: stems, beams and the key figures (round wood, sawn timber, yield), which KeyFigures calculates;
 * this class only lays them out in columns, sheets and notes. Reads the projections, whose values
 * are already effective (own, or inherited from the stem for inheritable attributes). Attributes are found by
 * key only; their display names, headings and notes come from the database.
 *
 * Holds the loaded data in properties while building, so call build() one run at a time.
 */
final class TimberReport
{
    /** As TAG_DIGITS in frontend/app/src/config/constants.ts. */
    private const TAG_DIGITS = 5;
    private const SERIES_SEPARATOR = ' | ';
    private const REQUIRED_KEYS = ['mid_diameter_max', 'mid_diameter_min', 'length', 'sawn', 'sawn_cross_section', 'notes', 'photos'];
    private const DATE_TIME = 'dd.mm.yyyy hh:mm';
    private const PHOTO_IDS = 'Foto-IDs';

    /** @var array<string, Attribute> by key */
    private array $key = [];
    /** @var array<string, array<string, list<array>>> value records by item id and attribute id */
    private array $values = [];
    /** @var array<string, string> */
    private array $options = [];
    /** @var array<string, string> */
    private array $users = [];
    /** @var array<string, array{0: string, 1: string}> received_at and user id of the last own event, by item id */
    private array $changed = [];
    /** @var array<string, ?string> */
    private array $tags = [];
    /** @var array<string, list<TimberItem>> pieces of sawn timber by stem id: its beams, or the stem itself if sawn whole */
    private array $pieces = [];
    /** @var array<string, true> ids of attributes that at least one listed item has a value for */
    private array $used = [];
    /** @var array<string, Measures> by item id */
    private array $measures = [];
    /** @var array<string, StemFigures> by stem id */
    private array $figures = [];
    /** @var array<string, string> */
    private array $warnings = [];
    private \DateTimeZone $berlin;

    public function __construct(private readonly EntityManagerInterface $em, private readonly KeyFigures $keyFigures)
    {
    }

    /**
     * @throws \RuntimeException if an attribute the report needs does not exist
     */
    public function build(\DateTimeImmutable $now): Report
    {
        $this->berlin = new \DateTimeZone('Europe/Berlin');
        $this->warnings = $this->measures = $this->figures = $this->pieces = $this->used = [];
        $this->load();

        $items = $this->em->getRepository(TimberItem::class)->findBy(['voidedAt' => null]);
        usort($items, fn (TimberItem $a, TimberItem $b) => $this->sortKey($a) <=> $this->sortKey($b));
        $stems = array_values(array_filter($items, static fn (TimberItem $item) => null === $item->parentId));
        $reader = new MeasureReader($this->key, $this->options);
        foreach ($items as $item) {
            $this->measures[$item->id->toRfc4122()] = $reader->read($item, $this->values[$item->id->toRfc4122()] ?? []);
            $this->tags[$item->id->toRfc4122()] = $item->tagNumber;
            foreach ($this->values[$item->id->toRfc4122()] ?? [] as $attributeId => $_) {
                $this->used[$attributeId] = true;
            }
        }
        foreach ($reader->unreadable() as $unreadable) {
            $warning = \sprintf('Unreadable value left empty: %s, %s, "%s"', self::formatTag($unreadable['tag']) ?? $unreadable['item'], $unreadable['attribute'], $unreadable['text']);
            $this->warnings[$warning] = $warning;
        }
        $this->figures = $this->keyFigures->ofStems(array_values($this->measures));
        $stemPieces = new StemPieces(array_values($this->measures));
        $itemsById = [];
        foreach ($items as $item) {
            $itemsById[$item->id->toRfc4122()] = $item;
        }
        $sawnPieces = [];
        foreach ($stems as $stem) {
            $id = $stem->id->toRfc4122();
            $this->pieces[$id] = array_map(static fn (Measures $piece) => $itemsById[$piece->id], $stemPieces->piecesOf($id));
            array_push($sawnPieces, ...$this->pieces[$id]);
        }
        usort($sawnPieces, fn (TimberItem $a, TimberItem $b) => $this->sortKey($a) <=> $this->sortKey($b));

        $stemColumns = $this->stemColumns();
        $beamColumns = $this->beamColumns();
        $stemSheet = $this->sheet('Stämme', $stemColumns, $stems);
        $beamSheet = $this->sheet('Balken', $beamColumns, $sawnPieces);

        $notes = [];
        foreach ($this->rules() as $rule) {
            $notes[] = ['Grundregel', '', $rule];
        }
        foreach (['Stämme' => $stemColumns, 'Balken' => $beamColumns] as $category => $columns) {
            foreach ($columns as [$heading, , $meaning]) {
                $notes[] = [$category, $heading, $meaning];
            }
        }

        return new Report($stemSheet, $beamSheet, new Sheet('Hinweise', ['Kategorie', 'Spalte', 'Bedeutung'], [null, null, null], $notes), $now->setTimezone($this->berlin), array_values($this->warnings));
    }

    private function load(): void
    {
        $this->key = [];
        foreach ($this->em->getRepository(Attribute::class)->findAll() as $attribute) {
            if (null !== $attribute->key) {
                $this->key[$attribute->key] = $attribute;
            }
        }
        if ($missing = array_diff(self::REQUIRED_KEYS, array_keys($this->key))) {
            throw new \RuntimeException(\sprintf('The report needs attributes with the keys: %s. Missing in the database: %s.', implode(', ', self::REQUIRED_KEYS), implode(', ', $missing)));
        }

        $this->values = [];
        foreach ($this->em->getRepository(TimberItemState::class)->findAll() as $state) {
            $this->values[$state->timberItemId->toRfc4122()][$state->attributeId->toRfc4122()] = $state->valueRecords;
        }
        foreach ($this->em->getRepository(AttributeOption::class)->findAll() as $option) {
            $this->options[$option->id->toRfc4122()] = $option->label;
        }
        foreach ($this->em->getRepository(User::class)->findAll() as $user) {
            $this->users[$user->id->toRfc4122()] = $user->name;
        }
        // Own events only: a beam does not show a later change of a value inherited from its stem.
        // Same order as the projections (received_at, then id), so the last row per item wins and ties are decided the same way every time.
        $this->changed = [];
        foreach ($this->em->getConnection()->fetchAllNumeric('SELECT timber_item_id, received_at, user_id FROM timber_item_events ORDER BY received_at, id') as [$itemId, $receivedAt, $userId]) {
            $this->changed[Uuid::fromBinary($itemId)->toRfc4122()] = [$receivedAt, Uuid::fromBinary($userId)->toRfc4122()];
        }
    }

    /**
     * @param list<array{0: string, 1: ?string, 2: string, 3: \Closure(TimberItem): mixed}> $columns heading, format, meaning, value
     * @param list<TimberItem>                                                              $items
     */
    private function sheet(string $name, array $columns, array $items): Sheet
    {
        return new Sheet(
            $name,
            array_column($columns, 0),
            array_column($columns, 1),
            array_map(static fn (TimberItem $item) => array_map(static fn (array $column) => $column[3]($item), $columns), $items),
            array_keys(array_filter(array_column($columns, 0), static fn (string $heading) => self::PHOTO_IDS === $heading)),
        );
    }

    /** @return list<array{0: string, 1: ?string, 2: string, 3: \Closure}> */
    private function stemColumns(): array
    {
        $columns = [['Stamm', null, 'Plakettennummer des Stamms', fn (TimberItem $stem) => self::formatTag($stem->tagNumber)]];
        foreach ($this->listedAttributes(['sawn_cross_section', 'notes', 'photos']) as $attribute) {
            $columns[] = match ($attribute->key) {
                'sawn' => [$attribute->name, null, \sprintf('Abgeleitet, nicht der erfasste Wert: ja, wenn der Stamm Balken hat, einen „%s“ hat oder „%s“ = ja erfasst ist', $this->key['sawn_cross_section']->name, $attribute->name), fn (TimberItem $stem) => $this->figures[$stem->id->toRfc4122()]->isSawn() ? 'ja' : 'nein'],
                default => $this->attributeColumn($attribute, false),
            };
        }
        $columns[] = ['Anzahl Balken', null, 'Zeilen dieses Stamms auf „Balken“: 0 = ungesägt, 1 = als Ganzes gesägt', fn (TimberItem $stem) => \count($this->pieces[$stem->id->toRfc4122()])];
        $columns[] = ['Rundholz (fm)', '0.000', \sprintf('Festmeter Rundholz = π/4 × „%s“/100 × „%s“/100 × „%s“; leer, wenn ein Wert fehlt oder 0 ist; ist nur ein Durchmesser erfasst (der andere leer oder 0), gilt er für beide, der Stamm wird als kreisrund gerechnet (vorläufige Formel)', $this->key['mid_diameter_max']->name, $this->key['mid_diameter_min']->name, $this->key['length']->name), fn (TimberItem $stem) => $this->figures[$stem->id->toRfc4122()]->roundWood->volume];
        $columns[] = ['Schnittholz (m³)', '0.000', 'Summe des Schnittholzes aller Balken dieses Stamms; leer, wenn der Stamm ungesägt ist oder ein Balken kein Schnittholz hat', fn (TimberItem $stem) => $this->figures[$stem->id->toRfc4122()]->sawnTimber?->volume];
        $columns[] = ['Ausbeute', '0 %', 'Schnittholz ÷ Rundholz: Anteil des Stamms, der im Balken landet; der Rest ist Verschnitt. Leer, wenn eins von beiden leer ist', fn (TimberItem $stem) => $this->figures[$stem->id->toRfc4122()]->yield];

        return [...$columns, ...$this->closingColumns('des Stamms selbst')];
    }

    /** @return list<array{0: string, 1: ?string, 2: string, 3: \Closure}> */
    private function beamColumns(): array
    {
        $columns = [
            ['Balken', null, 'Plakettennummer des gesägten Stücks; bei einem als Ganzes gesägten Stamm die des Stamms', fn (TimberItem $piece) => self::formatTag($piece->tagNumber)],
            ['Stamm', null, 'Plakettennummer des Stamms, aus dem das Stück stammt', fn (TimberItem $piece) => self::formatTag($piece->parentId ? $this->tags[$piece->parentId->toRfc4122()] ?? null : $piece->tagNumber)],
        ];
        foreach ($this->listedAttributes(['mid_diameter_max', 'mid_diameter_min', 'sawn', 'sawn_cross_section', 'notes', 'photos']) as $attribute) {
            $columns[] = $this->attributeColumn($attribute, true);
        }
        $cross = $this->key['sawn_cross_section'];
        $columns[] = [$cross->name, null, 'Erfasster Querschnitt als Text', fn (TimberItem $piece) => $this->text($cross, $this->records($piece, $cross)[0]['value'] ?? '') ?: null];
        $columns[] = ['Breite (cm)', '0.0', \sprintf('Erste Zahl aus „%s“', $cross->name), fn (TimberItem $piece) => $this->measures[$piece->id->toRfc4122()]->width];
        $columns[] = ['Höhe (cm)', '0.0', \sprintf('Zweite Zahl aus „%s“', $cross->name), fn (TimberItem $piece) => $this->measures[$piece->id->toRfc4122()]->height];
        $columns[] = ['Schnittholz (m³)', '0.000', \sprintf('Kubikmeter Schnittholz = Breite/100 × Höhe/100 × „%s“; leer ohne Querschnitt', $this->key['length']->name), fn (TimberItem $piece) => $this->keyFigures->piece($this->measures[$piece->id->toRfc4122()])->volume];

        return [...$columns, ...$this->closingColumns('des Eintrags')];
    }

    /** @return list<array{0: string, 1: ?string, 2: string, 3: \Closure}> */
    private function closingColumns(string $whose): array
    {
        $dateTime = fn (?string $time) => null === $time ? null : (new \DateTimeImmutable($time, new \DateTimeZone('UTC')))->setTimezone($this->berlin);
        $notes = $this->key['notes'];
        $photos = $this->key['photos'];

        return [
            [$notes->name, null, \sprintf('Alle „%s“-Einträge %s, durch Zeilenumbruch getrennt', $notes->name, $whose), fn (TimberItem $item) => implode("\n", array_map(fn (array $record) => $this->text($notes, $record['value']), $this->records($item, $notes))) ?: null],
            ['Angelegt am', self::DATE_TIME, 'Zeitpunkt, zu dem der Eintrag in der App angelegt wurde (Gerätezeit, Europa/Berlin)', fn (TimberItem $item) => $item->createdAt->setTimezone($this->berlin)],
            ['Angelegt von', null, 'Person, die den Eintrag angelegt hat', fn (TimberItem $item) => $this->users[$item->createdBy->toRfc4122()] ?? null],
            ['Zuletzt geändert am', self::DATE_TIME, 'Eingang des letzten eigenen Ereignisses beim Server (Europa/Berlin); eine spätere Änderung am Stamm zählt bei Balken nicht', fn (TimberItem $item) => $dateTime($this->changed[$item->id->toRfc4122()][0] ?? null)],
            ['Zuletzt geändert von', null, 'Person, die das Ereignis von „Zuletzt geändert am“ erzeugt hat; eine spätere Änderung am Stamm zählt bei Balken nicht', fn (TimberItem $item) => $this->users[$this->changed[$item->id->toRfc4122()][1] ?? ''] ?? null],
            ['Anzahl Fotos', null, \sprintf('Anzahl der „%s“ %s', $photos->name, $whose), fn (TimberItem $item) => \count($this->records($item, $photos))],
            [self::PHOTO_IDS, null, \sprintf('IDs der „%s“ %s, durch Komma getrennt', $photos->name, $whose), fn (TimberItem $item) => implode(', ', array_column($this->records($item, $photos), 'value')) ?: null],
        ];
    }

    /** @return list<string> */
    private function rules(): array
    {
        $sawn = $this->key['sawn'];

        return [
            'Rundholz immer auf „Stämme“ summieren, Schnittholz immer auf „Balken“. Beide Blätter zusammen zu summieren zählt doppelt.',
            '„Balken“ enthält jedes gesägte Stück, auch Stämme, die als Ganzes gesägt wurden (dort ist die Spalte „Balken“ gleich der Spalte „Stamm“). Ungesägte Stämme stehen nur auf „Stämme“.',
            'Die Werte sind effektive Werte: der eigene Wert des Eintrags oder, bei vererbbaren Merkmalen, der Wert des Stamms. Durchmesser gibt es nur bei Stämmen. Eine leere Zelle heißt: nicht erfasst oder nicht berechenbar. Ein Durchmesser von 0 gilt als nicht gemessen. Ist nur ein Durchmesser erfasst (der andere leer oder 0), gilt er für beide: Der Stamm wird als kreisrund gerechnet.',
            \sprintf('„%s“ ist abgeleitet: ja, wenn der Stamm Balken hat oder einen „%s“ hat oder „%s“ = ja erfasst ist; sonst nein.', $sawn->name, $this->key['sawn_cross_section']->name, $sawn->name),
            'Die Formel für das Rundholz ist vorläufig, bis V29 sie bestätigt (mit oder ohne Rinde, Ellipse aus beiden Durchmessern oder Mittelwert).',
            '1 fm (Festmeter) = 1 m³ massives Holz. Ausbeute = Anteil des Stamms, der im Balken landet; der Rest ist Verschnitt.',
            'Entfernte Einträge fehlen. Alle Zahlen sind feste Werte, keine Excel-Formeln.',
        ];
    }

    /**
     * @param list<string> $exceptKeys
     *
     * @return list<Attribute> active attributes, and inactive ones some listed item still has a value for, in list order
     */
    private function listedAttributes(array $exceptKeys): array
    {
        $attributes = $this->em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC']);

        return array_values(array_filter($attributes, fn (Attribute $attribute) => !\in_array($attribute->key, $exceptKeys, true)
            && ($attribute->active || isset($this->used[$attribute->id->toRfc4122()]))));
    }

    /** @return array{0: string, 1: ?string, 2: string, 3: \Closure} */
    private function attributeColumn(Attribute $attribute, bool $onBeamSheet): array
    {
        $meaning = ($onBeamSheet && $attribute->isInheritable ? 'Wert des Balkens, sonst vom Stamm geerbt' : 'Erfasster Wert des Merkmals').($attribute->active ? '' : ' (inaktives Merkmal, es gibt noch Werte)').($attribute->unit ? ', Einheit '.$attribute->unit : '').($attribute->description ? '. '.$attribute->description : '');
        $column = static fn (string $heading, ?string $format, string $meaning, \Closure $value) => [$heading, $format, $meaning, $value];

        return match ($attribute->key) {
            'mid_diameter_max' => $column($attribute->name.' (cm)', null, $meaning.'; 0 = nicht gemessen, dann leer', fn (TimberItem $item) => $this->measures[$item->id->toRfc4122()]->diameterMax ?: null),
            'mid_diameter_min' => $column($attribute->name.' (cm)', null, $meaning.'; 0 = nicht gemessen, dann leer', fn (TimberItem $item) => $this->measures[$item->id->toRfc4122()]->diameterMin ?: null),
            'length' => $column($attribute->name.' (m)', '0.00', $meaning.'; als Zahl in Metern', fn (TimberItem $item) => $this->measures[$item->id->toRfc4122()]->length),
            default => $column($attribute->name, AttributeType::Date === $attribute->type ? 'dd.mm.yyyy' : null, $meaning, fn (TimberItem $item) => $this->cell($attribute, $this->records($item, $attribute))),
        };
    }

    /** @param list<array{value: bool|int|float|string, recorded_at: string, user_id: string, event_id: string}> $records */
    private function cell(Attribute $attribute, array $records): mixed
    {
        return match (true) {
            [] === $records => null,
            $attribute->isSeries => implode(self::SERIES_SEPARATOR, array_map(fn (array $record) => $this->text($attribute, $record['value']), $records)),
            AttributeType::Number === $attribute->type => $records[0]['value'],
            // Midnight as written, no time zone shift: the cell shows a date, not a point in time.
            AttributeType::Date === $attribute->type => new \DateTimeImmutable($records[0]['value']),
            default => $this->text($attribute, $records[0]['value']),
        };
    }

    private function text(Attribute $attribute, bool|int|float|string $value): string
    {
        return ValueText::forExport($attribute->type, $value, $this->options);
    }

    /** @return list<array{value: bool|int|float|string, recorded_at: string, user_id: string, event_id: string}> */
    private function records(TimberItem $item, Attribute $attribute): array
    {
        return $this->values[$item->id->toRfc4122()][$attribute->id->toRfc4122()] ?? [];
    }

    /** Sorts "123" before "123-A" before "124"; items without a tag last. */
    private function sortKey(TimberItem $item): string
    {
        return self::formatTag($item->tagNumber) ?? "\xff";
    }

    /** "123-A" → "00123-A", as on the plaque. */
    private static function formatTag(?string $tag): ?string
    {
        return null === $tag ? null : preg_replace_callback('/^\d+/', static fn (array $match) => str_pad($match[0], self::TAG_DIGITS, '0', \STR_PAD_LEFT), $tag);
    }
}
