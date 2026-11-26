<?php

namespace App\User;

use App\Entity\Attribute;
use App\Entity\User;
use App\Entity\UserGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Maintenance of user groups in the administration: GET/POST/PATCH/DELETE /api/admin/groups, see AdminGroup in frontend/admin/src/api/contract.ts.
 * All rules live here; the controller stays thin. Who belongs to a group is set on the user (UserAdmin), not here.
 */
final class GroupAdmin
{
    private const int NAME_MAX = 255;

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /** @return list<array<string, mixed>> by name */
    public function all(): array
    {
        return array_map($this->view(...), $this->em->getRepository(UserGroup::class)->findBy([], ['name' => 'ASC']));
    }

    /** @return array<string, mixed> */
    public function view(UserGroup $group): array
    {
        $members = $this->em->getRepository(User::class)->findBy(['group' => $group], ['name' => 'ASC']);

        return [
            'id' => $group->id->toRfc4122(),
            'name' => $group->name,
            'sees_all_attributes' => $group->seesAllAttributes,
            'attribute_ids' => $group->seesAllAttributes ? [] : array_map(static fn (Attribute $a) => $a->id->toRfc4122(), $this->sorted($group)),
            'users' => array_map(static fn (User $user) => ['id' => $user->id->toRfc4122(), 'name' => $user->name], $members),
        ];
    }

    /**
     * @param array<mixed> $body name, sees_all_attributes, attribute_ids; a new group sees only the enabled ones, none yet
     *
     * @throws InvalidUser
     */
    public function create(array $body): UserGroup
    {
        $group = new UserGroup('', false);
        $this->apply($group, $body);
        $this->em->persist($group);
        $this->em->flush();

        return $group;
    }

    /**
     * Fields missing in the body stay as they are.
     *
     * @param array<mixed> $body
     *
     * @throws InvalidUser
     */
    public function update(UserGroup $group, array $body): void
    {
        $this->apply($group, $body);
        $this->em->flush();
    }

    /** @throws GroupInUse */
    public function delete(UserGroup $group): void
    {
        if ($this->em->getRepository(User::class)->count(['group' => $group]) > 0) {
            throw new GroupInUse('The group still has users.');
        }
        $this->em->remove($group);
        $this->em->flush();
    }

    /**
     * @param array<mixed> $body
     *
     * @throws InvalidUser
     */
    private function apply(UserGroup $group, array $body): void
    {
        $errors = [];
        $name = $group->name;
        if (\array_key_exists('name', $body) || '' === $name) {
            $name = $this->checkName($body['name'] ?? null, $group, $errors);
        }
        $seesAll = $group->seesAllAttributes;
        if (\array_key_exists('sees_all_attributes', $body)) {
            if (\is_bool($body['sees_all_attributes'])) {
                $seesAll = $body['sees_all_attributes'];
            } else {
                $errors[] = ['field' => 'sees_all_attributes', 'message' => 'Der Wert muss wahr oder falsch sein.'];
            }
        }
        $attributes = null;
        if (\array_key_exists('attribute_ids', $body)) {
            $attributes = $this->checkAttributes($body['attribute_ids'], $errors);
        }
        if ($errors) {
            throw new InvalidUser($errors);
        }

        $group->name = $name;
        $group->seesAllAttributes = $seesAll;
        // The list only counts while the group sees just the enabled ones; a group that sees all keeps none.
        if ($seesAll) {
            $group->enable([]);
        } elseif (null !== $attributes) {
            $group->enable($attributes);
        }
    }

    /** @param list<array{field: string, message: string}> $errors */
    private function checkName(mixed $name, UserGroup $group, array &$errors): string
    {
        $name = \is_string($name) ? trim($name) : '';
        if ('' === $name) {
            $errors[] = ['field' => 'name', 'message' => 'Bitte einen Namen eingeben.'];
        } elseif (mb_strlen($name) > self::NAME_MAX) {
            $errors[] = ['field' => 'name', 'message' => \sprintf('Der Name darf höchstens %d Zeichen lang sein.', self::NAME_MAX)];
        } else {
            // The database compares without regard to case, so does this lookup.
            $same = $this->em->getRepository(UserGroup::class)->findOneBy(['name' => $name]);
            if ($same && !$same->id->equals($group->id)) {
                $errors[] = ['field' => 'name', 'message' => 'Diese Gruppe gibt es schon.'];
            }
        }

        return $name;
    }

    /**
     * @param list<array{field: string, message: string}> $errors
     *
     * @return list<Attribute>
     */
    private function checkAttributes(mixed $ids, array &$errors): array
    {
        if (!\is_array($ids) || !array_is_list($ids) || array_filter($ids, static fn (mixed $id) => !\is_string($id))) {
            $errors[] = ['field' => 'attribute_ids', 'message' => 'Die Merkmale müssen eine Liste von IDs sein.'];

            return [];
        }
        $attributes = [];
        foreach (array_unique($ids) as $id) {
            $attribute = Uuid::isValid($id) ? $this->em->find(Attribute::class, Uuid::fromString($id)) : null;
            if (!$attribute) {
                $errors[] = ['field' => 'attribute_ids', 'message' => 'Ein ausgewähltes Merkmal gibt es nicht.'];

                return [];
            }
            $attributes[] = $attribute;
        }

        return $attributes;
    }

    /** @return list<Attribute> in the order of the attributes */
    private function sorted(UserGroup $group): array
    {
        $attributes = $group->attributes->toArray();
        usort($attributes, static fn (Attribute $a, Attribute $b) => $a->sortOrder <=> $b->sortOrder);

        return $attributes;
    }
}
