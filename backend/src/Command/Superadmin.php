<?php

namespace App\Command;

use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;

/**
 * The one superadmin: the console commands that write events record them under this user, and the user commands
 * make sure there is never a second one.
 */
class Superadmin
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /**
     * @param User|null $except a user who may be the superadmin already (setting the role again is no conflict)
     */
    public function find(?User $except = null): ?User
    {
        return array_find(
            $this->em->getRepository(User::class)->findBy(['role' => UserRole::Superadmin, 'revokedAt' => null]),
            static fn (User $user) => $user !== $except,
        );
    }

    /**
     * @return User|string the user the events are recorded under, or the reason there is none
     */
    public function author(): User|string
    {
        return $this->find() ?? 'There is no active superadmin to record the changes under. Make one with app:user:role <name or ID> superadmin.';
    }

    /**
     * @return string|null why no further superadmin may be made; null if that is fine
     */
    public function conflict(?User $except = null): ?string
    {
        $existing = $this->find($except);

        return $existing ? \sprintf('Es gibt schon einen Superadmin: %s (%s), erst auf admin setzen.', $existing->name, $existing->id->toRfc4122()) : null;
    }
}
