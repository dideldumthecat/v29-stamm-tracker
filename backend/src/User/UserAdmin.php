<?php

namespace App\User;

use App\Api\Timestamp;
use App\Entity\User;
use App\Entity\UserRole;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\Uid\Uuid;

/**
 * User management in the administration: GET/POST/PATCH /api/admin/users, see AdminUser in frontend/shared/contract.ts.
 * All rules live here; the controller only passes the acting user. The console commands app:user:* stay for the first superadmin.
 *
 * Who may do what (the interface hides the rest, the server refuses it with 403):
 * - admin and superadmin: create, rename, block and unblock users with the role "user", issue them a new invite code.
 * - only the superadmin: the same for users with the role "admin", and giving or taking the role "admin".
 * - nobody: change, block or create a superadmin; blocking oneself. Users are never deleted, their events refer to them.
 */
final class UserAdmin
{
    private const int NAME_MAX = 255;

    public function __construct(private readonly EntityManagerInterface $em, private readonly Invites $invites)
    {
    }

    /** @return list<UserRole> the roles the actor may give to a new user */
    public function creatableRoles(User $actor): array
    {
        return UserRole::Superadmin === $actor->role ? [UserRole::User, UserRole::Admin] : [UserRole::User];
    }

    /** May the actor rename, block, unblock the target and issue it an invite? (Blocking also excludes oneself, see canBlock.) */
    public function canManage(User $actor, User $target): bool
    {
        return match ($target->role) {
            UserRole::User => true,
            UserRole::Admin => UserRole::Superadmin === $actor->role && $target !== $actor,
            UserRole::Superadmin => false,
        };
    }

    public function canBlock(User $actor, User $target): bool
    {
        return $target !== $actor && $this->canManage($actor, $target);
    }

    public function canSetRole(User $actor, User $target): bool
    {
        return UserRole::Superadmin === $actor->role && UserRole::Superadmin !== $target->role;
    }

    /**
     * @param array<string, \DateTimeImmutable> $lastActive as returned by lastActive()
     *
     * @return array<string, mixed>
     */
    public function view(User $actor, User $user, array $lastActive): array
    {
        $id = $user->id->toRfc4122();

        return [
            'id' => $id,
            'name' => $user->name,
            'role' => $user->role->value,
            'created_at' => Timestamp::format($user->createdAt),
            'revoked_at' => $user->revokedAt ? Timestamp::format($user->revokedAt) : null,
            'last_active_at' => isset($lastActive[$id]) ? Timestamp::format($lastActive[$id]) : null,
            'can_manage' => $this->canManage($actor, $user),
            'can_block' => $this->canBlock($actor, $user),
            'can_set_role' => $this->canSetRole($actor, $user),
        ];
    }

    /** @return list<User> in the order of creation */
    public function all(): array
    {
        return $this->em->getRepository(User::class)->findBy([], ['createdAt' => 'ASC']);
    }

    /** @return array<string, \DateTimeImmutable> by user id: the last time events of the user reached the server */
    public function lastActive(): array
    {
        $rows = $this->em->getConnection()->fetchAllKeyValue('SELECT user_id, MAX(received_at) FROM timber_item_events GROUP BY user_id');
        $result = [];
        foreach ($rows as $id => $time) {
            $result[Uuid::fromBinary((string) $id)->toRfc4122()] = new \DateTimeImmutable((string) $time, new \DateTimeZone('UTC'));
        }

        return $result;
    }

    /**
     * @return array{User, string} the new user and their formatted invite code
     *
     * @throws InvalidUser
     */
    public function create(User $actor, mixed $name, mixed $role): array
    {
        $errors = [];
        $name = $this->checkName($name, $errors);
        $userRole = \is_string($role) ? UserRole::tryFrom($role) : null;
        if (null === $userRole || UserRole::Superadmin === $userRole) {
            $errors[] = ['field' => 'role', 'message' => 'Bitte eine Rolle wählen.'];
        } elseif (!\in_array($userRole, $this->creatableRoles($actor), true)) {
            throw new AccessDeniedHttpException('Only the superadmin may create administrators.');
        }
        if ($errors) {
            throw new InvalidUser($errors);
        }

        $user = new User($name, $userRole, '');
        $code = $this->invites->issue($user);
        $this->em->persist($user);
        $this->em->flush();

        return [$user, $code];
    }

    /**
     * Fields missing in the body stay as they are.
     *
     * @param array<mixed> $body name, role and blocked
     *
     * @throws InvalidUser
     */
    public function update(User $actor, User $target, array $body): void
    {
        $errors = [];
        $name = $target->name;
        if (\array_key_exists('name', $body)) {
            $this->requireManage($actor, $target);
            $name = $this->checkName($body['name'], $errors);
        }
        $role = $target->role;
        if (\array_key_exists('role', $body) && ($body['role'] !== $target->role->value)) {
            $new = \is_string($body['role']) ? UserRole::tryFrom($body['role']) : null;
            if (!$this->canSetRole($actor, $target)) {
                throw new AccessDeniedHttpException('Only the superadmin may give or take the role "admin".');
            }
            if (null === $new || UserRole::Superadmin === $new) {
                $errors[] = ['field' => 'role', 'message' => 'Bitte eine Rolle wählen.'];
            } else {
                $role = $new;
            }
        }
        $blocked = null !== $target->revokedAt;
        if (\array_key_exists('blocked', $body)) {
            if (!\is_bool($body['blocked'])) {
                $errors[] = ['field' => 'blocked', 'message' => 'Der Wert muss wahr oder falsch sein.'];
            } elseif ($body['blocked'] !== $blocked) {
                if ($body['blocked'] ? !$this->canBlock($actor, $target) : !$this->canManage($actor, $target)) {
                    throw new AccessDeniedHttpException('You may not block or unblock this user.');
                }
                $blocked = $body['blocked'];
            }
        }
        if ($errors) {
            throw new InvalidUser($errors);
        }

        $target->name = $name;
        $target->role = $role;
        if ($blocked !== (null !== $target->revokedAt)) {
            $target->revokedAt = $blocked ? new \DateTimeImmutable() : null;
        }
        $this->em->flush();
    }

    /** Issues a new code; the old one stops working at once. */
    public function renewInvite(User $actor, User $target): string
    {
        $this->requireInviteAllowed($actor, $target);
        $code = $this->invites->issue($target);
        $this->em->flush();

        return $code;
    }

    private function requireManage(User $actor, User $target): void
    {
        if (!$this->canManage($actor, $target)) {
            throw new AccessDeniedHttpException('You may not change this user.');
        }
    }

    private function requireInviteAllowed(User $actor, User $target): void
    {
        $this->requireManage($actor, $target);
        if (null !== $target->revokedAt) {
            throw new ConflictHttpException('The user is blocked; unblock them first.');
        }
    }

    /** @param list<array{field: string, message: string}> $errors */
    private function checkName(mixed $name, array &$errors): string
    {
        $name = \is_string($name) ? trim($name) : '';
        if ('' === $name) {
            $errors[] = ['field' => 'name', 'message' => 'Bitte einen Namen eingeben.'];
        } elseif (mb_strlen($name) > self::NAME_MAX) {
            $errors[] = ['field' => 'name', 'message' => \sprintf('Der Name darf höchstens %d Zeichen lang sein.', self::NAME_MAX)];
        }

        return $name;
    }
}
