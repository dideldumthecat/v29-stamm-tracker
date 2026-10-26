<?php

namespace App\Entity;

use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'users')]
#[ORM\UniqueConstraint(name: 'uniq_users_token_hash', columns: ['token_hash'])]
class User
{
    #[ORM\Id]
    #[ORM\Column(type: UuidType::NAME)]
    public private(set) Uuid $id;

    public function __construct(
        #[ORM\Column(length: 255)]
        public string $name,
        #[ORM\Column(length: 16, enumType: UserRole::class)]
        public UserRole $role,
        /** SHA-256 of the invite token as hex. The token itself is never stored. */
        #[ORM\Column(length: 64, options: ['fixed' => true])]
        public string $tokenHash,
        #[ORM\Column(type: Types::DATETIME_IMMUTABLE)]
        public readonly \DateTimeImmutable $createdAt = new \DateTimeImmutable(),
        /** Set when the invite link is revoked; the user and their events stay. */
        #[ORM\Column(type: Types::DATETIME_IMMUTABLE, nullable: true)]
        public ?\DateTimeImmutable $revokedAt = null,
        ?Uuid $id = null,
    ) {
        $this->id = $id ?? Uuid::v7();
    }

    /** Crockford Base32: no I, L, O, U, so a code read aloud or typed off a screen cannot be mistaken. */
    public const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    public const CODE_LENGTH = 12;

    /**
     * A fast hash is enough: a code carries 60 random bits, so it cannot be guessed or
     * looked up in a table of known passwords. It has to be searchable by its hash, which rules out bcrypt-style hashes.
     */
    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * Invite codes are typed by hand: case, hyphens, spaces and the look-alikes O, I, L do not matter.
     */
    public static function normalizeToken(string $token): string
    {
        return strtr(strtoupper(str_replace(['-', ' '], '', $token)), 'OIL', '011');
    }
}
