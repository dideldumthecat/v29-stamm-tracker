<?php

namespace App\Controller;

use App\Entity\User;
use App\User\InvalidUser;
use App\User\UserActionDenied;
use App\User\UserAdmin;
use App\User\UserBlocked;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/** AdminUsersResponse, AdminUserInput and AdminInviteResponse in frontend/admin/src/api/contract.ts. The role check for /api/admin/ happens in AuthenticateListener, the rules of who may do what in UserAdmin. */
final class UserAdminController extends AbstractController
{
    use JsonBody;

    public function __construct(
        private readonly UserAdmin $users,
        private readonly EntityManagerInterface $em,
    ) {
    }

    #[Route('/api/admin/users', methods: ['GET'])]
    public function list(User $user): JsonResponse
    {
        $lastActive = $this->users->lastActive();

        return $this->json([
            'users' => array_map(fn (User $item) => $this->users->view($user, $item, $lastActive), $this->users->all()),
            'creatable_roles' => array_map(static fn ($role) => $role->value, $this->users->creatableRoles($user)),
        ]);
    }

    #[Route('/api/admin/users', methods: ['POST'])]
    public function create(User $user, Request $request): JsonResponse
    {
        return $this->guard(function () use ($user, $request) {
            $body = $this->body($request);
            [$target, $code] = $this->users->create($user, $body['name'] ?? null, $body['role'] ?? null, $body['group_id'] ?? null);

            return $this->json($this->answer($user, $target, $code), Response::HTTP_CREATED);
        });
    }

    #[Route('/api/admin/users/{id}', methods: ['PATCH'])]
    public function update(User $user, string $id, Request $request): JsonResponse
    {
        $target = $this->find($id);

        return $this->guard(function () use ($user, $target, $request) {
            $this->users->update($user, $target, $this->body($request));

            return $this->json(['user' => $this->users->view($user, $target, $this->users->lastActive())]);
        });
    }

    #[Route('/api/admin/users/{id}/invite', methods: ['POST'])]
    public function renewInvite(User $user, string $id): JsonResponse
    {
        $target = $this->find($id);

        return $this->guard(fn () => $this->json($this->answer($user, $target, $this->users->renewInvite($user, $target))));
    }

    /** @return array<string, mixed> */
    private function answer(User $actor, User $user, string $code): array
    {
        return [
            'user' => $this->users->view($actor, $user, $this->users->lastActive()),
            'invite' => ['code' => $code],
        ];
    }

    private function find(string $id): User
    {
        return (Uuid::isValid($id) ? $this->em->find(User::class, Uuid::fromString($id)) : null) ?? throw new NotFoundHttpException('No such user.');
    }

    /** @param callable(): JsonResponse $action */
    private function guard(callable $action): JsonResponse
    {
        try {
            return $action();
        } catch (InvalidUser $e) {
            return $this->json(['errors' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        } catch (UserActionDenied $e) {
            throw new AccessDeniedHttpException($e->getMessage(), $e);
        } catch (UserBlocked $e) {
            throw new ConflictHttpException($e->getMessage(), $e);
        }
    }
}
