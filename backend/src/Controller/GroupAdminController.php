<?php

namespace App\Controller;

use App\Entity\UserGroup;
use App\User\GroupAdmin;
use App\User\GroupInUse;
use App\User\InvalidUser;
use App\User\UserGroups;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;

/** AdminGroupsResponse, AdminGroup and AdminGroupInput in frontend/admin/src/api/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class GroupAdminController extends AbstractController
{
    use JsonBody;

    public function __construct(private readonly GroupAdmin $groups, private readonly UserGroups $lookup)
    {
    }

    #[Route('/api/admin/groups', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json(['groups' => $this->groups->all()]);
    }

    #[Route('/api/admin/groups', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        return $this->guard(fn () => $this->json($this->groups->view($this->groups->create($this->body($request))), Response::HTTP_CREATED));
    }

    #[Route('/api/admin/groups/{id}', methods: ['PATCH'])]
    public function update(string $id, Request $request): JsonResponse
    {
        $group = $this->find($id);

        return $this->guard(function () use ($group, $request) {
            $this->groups->update($group, $this->body($request));

            return $this->json($this->groups->view($group));
        });
    }

    #[Route('/api/admin/groups/{id}', methods: ['DELETE'])]
    public function delete(string $id): Response
    {
        $group = $this->find($id);
        try {
            $this->groups->delete($group);
        } catch (GroupInUse $e) {
            throw new ConflictHttpException($e->getMessage(), $e);
        }

        return new Response(null, Response::HTTP_NO_CONTENT);
    }

    private function find(string $id): UserGroup
    {
        return $this->lookup->find($id) ?? throw new NotFoundHttpException('No such group.');
    }

    /** @param callable(): JsonResponse $action */
    private function guard(callable $action): JsonResponse
    {
        try {
            return $action();
        } catch (InvalidUser $e) {
            return $this->json(['errors' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }
}
