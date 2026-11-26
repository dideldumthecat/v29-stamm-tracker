<?php

namespace App\Pile;

use App\Attributes\InvalidAttribute;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\Pile;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Maintenance of the piles in the administration: GET/POST/PATCH /api/admin/piles, see AdminPile in frontend/admin/src/api/contract.ts.
 * A pile is an option of the attribute with the key "source" plus its master data (Pile). All rules live here.
 * The label of the option is derived from number and location on every save ("number (location)" or only the number), the value recorded on
 * timber items stays the option id. Nothing is deleted, the administration does not deactivate piles (attribute_options.active stays as it is).
 * No events: piles are configuration.
 */
final class PileEditor
{
    public const string SOURCE_KEY = 'source';
    private const int STEP = 10;
    private const int NUMBER_MAX = 32;
    private const int LOCATION_MAX = 200;
    private const array FIELDS = ['number', 'location', 'latitude', 'longitude', 'stacked_volume'];
    private const float VOLUME_MAX = 999999.99;

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /** The label of the option: "number (location)", or only the number. */
    public static function label(string $number, ?string $location): string
    {
        return null === $location ? $number : "$number ($location)";
    }

    /** @return list<array<string, mixed>> every option of the attribute, in order, inactive ones too */
    public function all(): array
    {
        $piles = $this->piles();

        return array_map(fn (AttributeOption $o) => self::view($o, $piles[$o->id->toRfc4122()] ?? null), $this->options());
    }

    /**
     * @param array<mixed> $body
     *
     * @return array<string, mixed>
     *
     * @throws InvalidAttribute
     */
    public function create(array $body): array
    {
        $attribute = $this->attribute();
        $in = $this->check(array_replace(
            ['number' => null, 'location' => null, 'latitude' => null, 'longitude' => null, 'stacked_volume' => null],
            $this->known($body),
        ), null);

        $last = $this->em->getConnection()->fetchOne('SELECT MAX(sort_order) FROM attribute_options WHERE attribute_id = ?', [$attribute->id], [UuidType::NAME]);
        $option = new AttributeOption($attribute, $in['label'], (int) $last + self::STEP);
        $this->em->persist($option);
        $this->em->persist($this->fill(new Pile($option, $in['number']), $in));
        $this->em->flush();

        return self::view($option, $this->em->find(Pile::class, $option->id));
    }

    /**
     * Fields missing in the body stay as they are. An option without a row gets it with the first save.
     *
     * @param array<mixed> $body
     *
     * @return array<string, mixed>
     *
     * @throws InvalidAttribute
     */
    public function update(AttributeOption $option, array $body): array
    {
        $pile = $this->em->find(Pile::class, $option->id);
        $current = [
            'number' => $pile?->number, 'location' => $pile?->location,
            'latitude' => null === $pile?->latitude ? null : (float) $pile->latitude,
            'longitude' => null === $pile?->longitude ? null : (float) $pile->longitude,
            'stacked_volume' => null === $pile?->stackedVolume ? null : (float) $pile->stackedVolume,
        ];
        $in = $this->check(array_replace($current, $this->known($body)), $option);

        $pile ??= new Pile($option, $in['number']);
        $option->label = $in['label'];
        $this->em->persist($this->fill($pile, $in));
        $this->em->flush();

        return self::view($option, $pile);
    }

    /** The option of the attribute "source" with this id, or null. */
    public function find(string $id): ?AttributeOption
    {
        foreach ($this->options() as $option) {
            if ($option->id->toRfc4122() === $id) {
                return $option;
            }
        }

        return null;
    }

    /**
     * @param array<mixed> $body
     *
     * @return array<string, mixed>
     */
    private function known(array $body): array
    {
        return array_intersect_key($body, array_flip(self::FIELDS));
    }

    /**
     * @param array<string, mixed> $in as returned by check()
     */
    private function fill(Pile $pile, array $in): Pile
    {
        $pile->number = $in['number'];
        $pile->location = $in['location'];
        $pile->latitude = null === $in['latitude'] ? null : number_format($in['latitude'], 6, '.', '');
        $pile->longitude = null === $in['longitude'] ? null : number_format($in['longitude'], 6, '.', '');
        $pile->stackedVolume = null === $in['stacked_volume'] ? null : number_format($in['stacked_volume'], 2, '.', '');

        return $pile;
    }

    /** @return array<string, mixed> */
    private static function view(AttributeOption $option, ?Pile $pile): array
    {
        return [
            'id' => $option->id->toRfc4122(),
            'label' => $option->label,
            'number' => $pile?->number,
            'location' => $pile?->location,
            'latitude' => null === $pile?->latitude ? null : (float) $pile->latitude,
            'longitude' => null === $pile?->longitude ? null : (float) $pile->longitude,
            'stacked_volume' => null === $pile?->stackedVolume ? null : (float) $pile->stackedVolume,
        ];
    }

    /**
     * Checks the complete state the pile will have and collects every violation.
     *
     * @param array<string, mixed> $in      the state to check
     * @param ?AttributeOption     $current the pile that is saved, null for a new one
     *
     * @return array{number: string, location: ?string, label: string, latitude: ?float, longitude: ?float, stacked_volume: ?float} the state with trimmed texts, the derived label and the numbers as floats
     *
     * @throws InvalidAttribute
     */
    private function check(array $in, ?AttributeOption $current): array
    {
        $errors = [];
        $fail = static function (string $field, string $message) use (&$errors): void {
            $errors[] = ['field' => $field, 'message' => $message];
        };

        $number = $this->text($in['number'], 'number', 'Die Nummer', self::NUMBER_MAX, $fail);
        $location = $this->text($in['location'], 'location', 'Der Lagerort', self::LOCATION_MAX, $fail);
        if (null === $number && [] === $errors) {
            $fail('number', 'Bitte eine Nummer eingeben.');
        }
        $label = self::label((string) $number, $location);

        if (null !== $number && $this->numberTaken($number, $current)) {
            $fail('number', 'Einen Polter mit dieser Nummer gibt es schon.');
        } elseif (null !== $number && $this->labelTaken($label, $current)) {
            $fail('number', 'Einen Polter mit dieser Bezeichnung gibt es schon.');
        }

        $latitude = $this->coordinate($in['latitude'], 'latitude', 'Die Breite', 90, $fail);
        $longitude = $this->coordinate($in['longitude'], 'longitude', 'Die Länge', 180, $fail);
        if (null === $latitude xor null === $longitude) {
            $fail(null === $latitude ? 'latitude' : 'longitude', 'Bitte Breite und Länge zusammen angeben.');
        }

        $volume = $in['stacked_volume'];
        if (null !== $volume && (!(\is_int($volume) || \is_float($volume)) || $volume <= 0 || $volume > self::VOLUME_MAX || abs($volume * 100 - round($volume * 100)) > 1e-6)) {
            $fail('stacked_volume', 'Die Raummeter müssen eine Zahl über 0 mit höchstens zwei Nachkommastellen sein.');
            $volume = null;
        }

        if ($errors) {
            throw new InvalidAttribute($errors);
        }

        return [
            'number' => (string) $number, 'location' => $location, 'label' => $label, 'latitude' => $latitude, 'longitude' => $longitude,
            'stacked_volume' => null === $volume ? null : (float) $volume,
        ];
    }

    /**
     * @param callable(string, string): void $fail
     *
     * @return ?string the trimmed text, null for an empty one
     */
    private function text(mixed $value, string $field, string $name, int $max, callable $fail): ?string
    {
        if (null === $value) {
            return null;
        }
        if (!\is_string($value)) {
            $fail($field, "$name muss ein Text sein.");

            return null;
        }
        $value = trim($value);
        if (mb_strlen($value) > $max) {
            $fail($field, "$name darf höchstens $max Zeichen lang sein.");

            return null;
        }

        return '' === $value ? null : $value;
    }

    /** @param callable(string, string): void $fail */
    private function coordinate(mixed $value, string $field, string $name, int $limit, callable $fail): ?float
    {
        if (null === $value) {
            return null;
        }
        if (!(\is_int($value) || \is_float($value)) || abs($value) > $limit) {
            $fail($field, "$name muss eine Zahl zwischen -$limit und $limit sein.");

            return null;
        }

        return (float) $value;
    }

    private function numberTaken(string $number, ?AttributeOption $current): bool
    {
        foreach ($this->em->getRepository(Pile::class)->findAll() as $other) {
            if ($other->option !== $current && mb_strtolower($other->number) === mb_strtolower($number)) {
                return true;
            }
        }

        return false;
    }

    private function labelTaken(string $label, ?AttributeOption $current): bool
    {
        foreach ($this->options() as $other) {
            if ($other !== $current && mb_strtolower($other->label) === mb_strtolower($label)) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, Pile> by option id */
    private function piles(): array
    {
        $piles = [];
        foreach ($this->em->getRepository(Pile::class)->findAll() as $pile) {
            $piles[$pile->option->id->toRfc4122()] = $pile;
        }

        return $piles;
    }

    /** @return list<AttributeOption> in order, inactive ones too; none without the attribute */
    private function options(): array
    {
        $attribute = $this->em->getRepository(Attribute::class)->findOneBy(['key' => self::SOURCE_KEY]);

        return $attribute ? $this->em->getRepository(AttributeOption::class)->findBy(['attribute' => $attribute], ['sortOrder' => 'ASC']) : [];
    }

    private function attribute(): Attribute
    {
        return $this->em->getRepository(Attribute::class)->findOneBy(['key' => self::SOURCE_KEY]) ?? throw new NotFoundHttpException('No attribute with the key "source".');
    }
}
