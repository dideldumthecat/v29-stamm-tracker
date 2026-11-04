<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * A configurable attribute ("Merkmal"), see Attribute in frontend/shared/contract.ts.
 * Never deleted, only deactivated: old values must stay displayable.
 *
 * The optional key is how code and console commands refer to an attribute; the name is only for display and may change.
 * Once set it never changes, and it is not part of the API contract.
 */
#[ORM\Entity]
#[ORM\Table(name: 'attributes')]
class Attribute
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    public const int KEY_MAX_LENGTH = 64;

    #[ORM\Column(name: '`key`', length: self::KEY_MAX_LENGTH, unique: true, nullable: true)]
    public private(set) ?string $key = null;

    public function __construct(
        #[ORM\Column(length: 255)]
        public string $name,
        #[ORM\Column(length: 16, enumType: AttributeType::class)]
        public AttributeType $type,
        #[ORM\Column(type: 'text')]
        public string $description = '',
        /** Only for type "number". */
        #[ORM\Column(length: 32, nullable: true)]
        public ?string $unit = null,
        #[ORM\Column]
        public bool $isSeries = false,
        #[ORM\Column]
        public bool $isInheritable = false,
        #[ORM\Column]
        public int $sortOrder = 0,
        #[ORM\Column]
        public bool $active = true,
        ?Uuid $id = null,
        ?string $key = null,
    ) {
        $this->id = $id ?? Uuid::v7();
        if (null !== $key) {
            $this->assignKey($key);
        }
    }

    public static function isValidKey(string $key): bool
    {
        return \strlen($key) <= self::KEY_MAX_LENGTH && 1 === preg_match('/^[a-z][a-z0-9_]*$/D', $key);
    }

    /**
     * @throws \InvalidArgumentException if the key is malformed or differs from the one already set
     */
    public function assignKey(string $key): void
    {
        if (!self::isValidKey($key)) {
            throw new \InvalidArgumentException(\sprintf('Invalid attribute key "%s": use lowercase letters, digits and underscores, starting with a letter, at most %d characters.', $key, self::KEY_MAX_LENGTH));
        }
        if (null !== $this->key && $this->key !== $key) {
            throw new \InvalidArgumentException(\sprintf('The key of an attribute never changes (is "%s", not "%s").', $this->key, $key));
        }
        $this->key = $key;
    }
}
