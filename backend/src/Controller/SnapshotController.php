<?php

namespace App\Controller;

use App\Api\Timestamp;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\TimberItem;
use App\Entity\TimberItemState;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Snapshot in frontend/src/api/contract.ts – the same for every user.
 */
final class SnapshotController extends AbstractController
{
    #[Route('/api/snapshot', methods: ['GET'])]
    public function __invoke(EntityManagerInterface $em): JsonResponse
    {
        $options = [];
        foreach ($em->getRepository(AttributeOption::class)->findBy([], ['sortOrder' => 'ASC']) as $option) {
            $options[$option->attribute->id->toRfc4122()][] = [
                'id' => $option->id->toRfc4122(),
                'label' => $option->label,
                'sort_order' => $option->sortOrder,
                'active' => $option->active,
            ];
        }

        $values = [];
        foreach ($em->getRepository(TimberItemState::class)->findAll() as $state) {
            $values[$state->timberItemId->toRfc4122()][$state->attributeId->toRfc4122()] = $state->valueRecords;
        }

        $items = [];
        $voidedBeamTags = [];
        foreach ($em->getRepository(TimberItem::class)->findBy([], ['createdAt' => 'ASC']) as $item) {
            if (!$item->voidedAt) {
                $items[] = $item;
            } elseif ($item->parentId) {
                $voidedBeamTags[$item->parentId->toRfc4122()][] = $item->tagNumber;
            }
        }

        return $this->json([
            'schema_version' => 1,
            'generated_at' => Timestamp::format(new \DateTimeImmutable()),
            'users' => array_map(static fn (User $user) => [
                'id' => $user->id->toRfc4122(),
                'name' => $user->name,
            ], $em->getRepository(User::class)->findBy([], ['name' => 'ASC'])),
            'attributes' => array_map(static fn (Attribute $attribute) => [
                'id' => $attribute->id->toRfc4122(),
                'name' => $attribute->name,
                'description' => $attribute->description,
                'type' => $attribute->type->value,
                'unit' => $attribute->unit,
                'is_series' => $attribute->isSeries,
                'is_inheritable' => $attribute->isInheritable,
                'sort_order' => $attribute->sortOrder,
                'active' => $attribute->active,
                'options' => $options[$attribute->id->toRfc4122()] ?? [],
            ], $em->getRepository(Attribute::class)->findBy([], ['sortOrder' => 'ASC'])),
            'timber_items' => array_map(static fn (TimberItem $item) => [
                'id' => $item->id->toRfc4122(),
                'parent_id' => $item->parentId?->toRfc4122(),
                'tag_number' => $item->tagNumber,
                'has_children' => $item->hasChildren,
                'created_at' => Timestamp::format($item->createdAt),
                'created_by' => $item->createdBy->toRfc4122(),
                // An object, also when empty: a PHP array without keys would become [].
                'values' => (object) ($values[$item->id->toRfc4122()] ?? []),
                'voided_beam_tags' => $voidedBeamTags[$item->id->toRfc4122()] ?? [],
            ], $items),
        ]);
    }
}
