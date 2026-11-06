<?php

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;

/** Finds the user a command names by exact name or ID. */
class UserLookup
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /**
     * @param bool $activeOnly leave out users whose invite link is revoked
     *
     * @return User|string the user, or why there is none (unknown, or a name that several users have)
     */
    public function find(string $nameOrId, bool $activeOnly): User|string
    {
        $matches = array_values(array_filter(
            $this->em->getRepository(User::class)->findBy($activeOnly ? ['revokedAt' => null] : []),
            static fn (User $u) => $u->name === $nameOrId || $u->id->toRfc4122() === strtolower($nameOrId),
        ));

        return 1 === \count($matches) ? $matches[0] : \sprintf(
            'No %suser "%s" found, or the name is not unique. Use the ID from app:user:list.',
            $activeOnly ? 'active ' : '',
            $nameOrId,
        );
    }
}
