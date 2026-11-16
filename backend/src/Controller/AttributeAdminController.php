<?php

namespace App\Controller;

use App\Attributes\AttributeEditor;
use App\Attributes\InvalidAttribute;
use App\Entity\Attribute;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/** AdminAttributesResponse, AdminAttributeInput and AttributeErrorsResponse in frontend/shared/contract.ts. The role check for /api/admin/ happens in AuthenticateListener. */
final class AttributeAdminController extends AbstractController
{
    public function __construct(private readonly AttributeEditor $editor, private readonly EntityManagerInterface $em)
    {
    }

    #[Route('/api/admin/attributes', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return $this->json(['attributes' => $this->editor->all()]);
    }

    #[Route('/api/admin/attributes', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        return $this->guard(fn () => $this->json($this->editor->one($this->editor->create($this->body($request))), Response::HTTP_CREATED));
    }

    #[Route('/api/admin/attributes/order', methods: ['PUT'])]
    public function reorder(Request $request): JsonResponse
    {
        return $this->guard(function () use ($request) {
            $this->editor->reorder($this->body($request)['ids'] ?? null);

            return $this->json(['attributes' => $this->editor->all()]);
        });
    }

    #[Route('/api/admin/attributes/{id}', methods: ['PATCH'])]
    public function update(string $id, Request $request): JsonResponse
    {
        $attribute = Uuid::isValid($id) ? $this->em->find(Attribute::class, Uuid::fromString($id)) : null;
        if (!$attribute) {
            throw new NotFoundHttpException('No such attribute.');
        }
        if (null !== $attribute->key) {
            throw new AccessDeniedHttpException('System attributes are maintained in attributes.yaml.');
        }

        return $this->guard(function () use ($attribute, $request) {
            $this->editor->update($attribute, $this->body($request));

            return $this->json($this->editor->one($attribute));
        });
    }

    /** @return array<mixed> */
    private function body(Request $request): array
    {
        $body = json_decode($request->getContent(), true);
        if (!\is_array($body) || (array_is_list($body) && [] !== $body)) {
            throw new BadRequestHttpException('The body must be a JSON object.');
        }

        return $body;
    }

    /** @param callable(): JsonResponse $action */
    private function guard(callable $action): JsonResponse
    {
        try {
            return $action();
        } catch (InvalidAttribute $e) {
            return $this->json(['errors' => $e->errors], Response::HTTP_UNPROCESSABLE_ENTITY);
        }
    }
}
