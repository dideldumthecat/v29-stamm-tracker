<?php

namespace App\User;

use App\Entity\Attribute;
use App\Entity\User;
use App\Entity\UserGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** Looking up groups: the one new users get, the one an id names, and what a user's group hides in the app. */
final class UserGroups
{
    private const string DEFAULT_NAME = 'V29';

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /** The group that sees all attributes and is named "V29"; if there is none, the first group by name. Null without any group. */
    public function default(): ?UserGroup
    {
        $groups = $this->em->getRepository(UserGroup::class);

        return $groups->findOneBy(['name' => self::DEFAULT_NAME, 'seesAllAttributes' => true]) ?? $groups->findOneBy([], ['name' => 'ASC']);
    }

    public function find(mixed $id): ?UserGroup
    {
        return \is_string($id) && Uuid::isValid($id) ? $this->em->find(UserGroup::class, Uuid::fromString($id)) : null;
    }

    /** @return list<string> ids of the attributes (RFC 4122, in their order) the user's group does not see; all attributes stay in the snapshot */
    public function hiddenAttributeIds(User $user): array
    {
        if ($user->group->seesAllAttributes) {
            return [];
        }
        $enabled = array_flip($user->group->attributes->map(static fn (Attribute $attribute) => $attribute->id->toRfc4122())->toArray());
        $hidden = [];
        foreach ($this->em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC']) as $attribute) {
            if (!isset($enabled[$attribute->id->toRfc4122()])) {
                $hidden[] = $attribute->id->toRfc4122();
            }
        }

        return $hidden;
    }
}
