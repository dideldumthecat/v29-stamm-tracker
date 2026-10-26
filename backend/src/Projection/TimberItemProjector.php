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
     * Empties both tables and projects every item that has events. Returns the number of items.
     */
    public function rebuildAll(): int
    {
        $db = $this->em->getConnection();

        // One transaction: the API never sees half-empty tables. DELETE, not TRUNCATE, which would commit implicitly.
        return $db->transactional(function () use ($db): int {
            $db->executeStatement('DELETE FROM timber_item_state');
            $db->executeStatement('DELETE FROM timber_items');
            $ids = $db->fetchFirstColumn('SELECT DISTINCT timber_item_id FROM timber_item_events');
            foreach ($ids as $id) {
                $this->project(Uuid::fromBinary($id));
                $this->em->clear();
            }

            return \count($ids);
        });
    }

    /**
     * Recomputes the item's rows in both tables from its events and replaces the old ones, then does the same
     * for its children, whose inherited values may have changed.
     */
    public function project(Uuid $timberItemId): void
    {
        ['item' => $item, 'tag_number' => $tagNumber, 'values' => $values] = $this->fromOwnEvents($timberItemId);
        if ($item['parent_id'] ?? null) {
            // Per attribute the own value wins; a series counts as one value, so own recordings replace the parent's.
            $values += $this->passedOnValues($item['parent_id']);
        }

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

        // Children not projected yet (during a rebuild) compute their inherited values from events when their turn comes.
        // Terminates: SyncController only accepts an existing parent, so parent_id never points to a later item.
        $children = $db->fetchFirstColumn('SELECT id FROM timber_items WHERE parent_id = ?', [$timberItemId], [UuidType::NAME]);
        foreach ($children as $childId) {
            $this->project(Uuid::fromBinary($childId));
        }
    }

    /**
     * What the item passes on to its children: its own values of inheritable attributes, otherwise what it inherits itself.
     * Read from events, not from the parent's projection rows, so the result does not depend on projection order.
     *
     * @return array<string, list<array>> records per attribute id
     */
    private function passedOnValues(Uuid $timberItemId): array
    {
        ['item' => $item, 'values' => $values] = $this->fromOwnEvents($timberItemId);
        $values = array_filter($values, fn (string $attributeId) => $this->em->find(Attribute::class, Uuid::fromString($attributeId))->isInheritable, \ARRAY_FILTER_USE_KEY);

        return $values + (($item['parent_id'] ?? null) ? $this->passedOnValues($item['parent_id']) : []);
    }

    /**
     * @return array{item: ?array, tag_number: ?string, values: array<string, list<array>>} item is null without a created event
     */
    private function fromOwnEvents(Uuid $timberItemId): array
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
                    //  A voided beam must still tell the app the stem's highest beam letter, or the app hands it out again.
            }
        }

        return ['item' => $item, 'tag_number' => $tagNumber, 'values' => $values];
    }
}
