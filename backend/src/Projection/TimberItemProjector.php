<?php

namespace App\Projection;

use App\Api\Timestamp;
use App\Entity\Attribute;
use App\Entity\EventType;
use App\Repository\TimberItemEventRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * The only writer of the projections timber_items and timber_item_state.
 * Writes through DBAL: rows are replaced wholesale, so there are no managed entities to keep in sync.
 */
final class TimberItemProjector
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TimberItemEventRepository $events,
    ) {
    }

    /**
     * Recomputes the item's rows in both tables from its events and replaces the old ones.
     */
    public function project(Uuid $timberItemId): void
    {
        $item = null;
        $tagNumber = null;
        $values = [];
        foreach ($this->events->findInReceiptOrder($timberItemId) as $event) {
            switch ($event->type) {
                case EventType::Created:
                    $item ??= [
                        'parent_id' => $event->data['parent_id'] ? Uuid::fromString($event->data['parent_id']) : null,
                        'created_at' => $event->recordedAt,
                        'created_by' => $event->user->id,
                    ];
                    break;
                case EventType::TagAssigned:
                    $tagNumber = $event->data['tag_number'];
                    break;
                case EventType::AttributeRecorded:
                    $attributeId = $event->data['attribute_id'];
                    $record = [
                        'value' => $event->data['value'],
                        'recorded_at' => Timestamp::format($event->recordedAt),
                        'user_id' => $event->user->id->toRfc4122(),
                        'event_id' => $event->id->toRfc4122(),
                    ];
                    $isSeries = $this->em->find(Attribute::class, Uuid::fromString($attributeId))?->isSeries;
                    $values[$attributeId] = $isSeries ? [...$values[$attributeId] ?? [], $record] : [$record];
                    break;
                default:
                    // TODO: apply corrected and voided events (voided items disappear from the snapshot).
            }
        }
        // TODO: inherit values of is_inheritable attributes from the parent (own value wins), and re-project
        //  the children when a parent changes.

        $db = $this->em->getConnection();
        $db->delete('timber_item_state', ['timber_item_id' => $timberItemId], [UuidType::NAME]);
        $db->delete('timber_items', ['id' => $timberItemId], [UuidType::NAME]);
        if (!$item) {
            return;
        }

        $hasChildren = (bool) $db->fetchOne(
            'SELECT 1 FROM timber_item_events WHERE type = ? AND JSON_VALUE(data, ?) = ? LIMIT 1',
            [EventType::Created->value, '$.parent_id', $timberItemId->toRfc4122()],
        );
        $db->insert('timber_items', [
            'id' => $timberItemId,
            'parent_id' => $item['parent_id'],
            'tag_number' => $tagNumber,
            'has_children' => $hasChildren,
            'created_at' => $item['created_at'],
            'created_by' => $item['created_by'],
        ], [UuidType::NAME, UuidType::NAME, Types::STRING, Types::BOOLEAN, Types::DATETIME_IMMUTABLE, UuidType::NAME]);
        foreach ($values as $attributeId => $records) {
            $db->insert('timber_item_state', [
                'timber_item_id' => $timberItemId,
                'attribute_id' => Uuid::fromString($attributeId),
                'value_records' => $records,
            ], [UuidType::NAME, UuidType::NAME, Types::JSON]);
        }
    }
}
