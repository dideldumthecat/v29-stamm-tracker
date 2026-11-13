<?php

namespace App\Activity;

use App\Api\Timestamp;
use App\Command\StemSelection;
use App\Entity\Attribute;
use App\Entity\AttributeOption;
use App\Entity\AttributeType;
use App\Report\ValueText;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Types\UuidType;
use Symfony\Component\Uid\Uuid;

/**
 * ActivityResponse in frontend/shared/contract.ts: who recorded what and when, newest first.
 *
 * Works in two steps so a page stays cheap with tens of thousands of events: all events matching the filter are read
 * with a few small columns and grouped into entries; only the events of the entries on the requested page are read in full.
 */
final class ActivityLog
{
    public const PAGE_SIZE = 50;
    /**
     * An entry is a run of events from one person. SyncController stamps the events of one sync
     * microseconds apart, so a gap of a second starts a new entry.
     */
    private const MAX_GAP_MICROSECONDS = 1_000_000;
    private const DB_FORMAT = 'Y-m-d H:i:s.u';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly StemSelection $selection,
    ) {
    }

    /**
     * @param string|null $from   first day (German time), inclusive
     * @param string|null $to     last day (German time), inclusive
     * @param string|null $tags   a range as for the console commands, e.g. 104 or 100-120; stems also match their beams
     * @param string|null $before cursor of the last entry of the previous page
     *
     * @return array<string, mixed> see ActivityPage in frontend/shared/contract.ts
     *
     * @throws \InvalidArgumentException with a message for the client if a filter is malformed
     */
    public function page(?string $from, ?string $to, ?string $user, ?string $tags, ?string $before): array
    {
        $where = ['1 = 1'];
        $params = [];
        $types = [];
        $berlin = new \DateTimeZone('Europe/Berlin');
        foreach (['from' => [$from, '>=', '+0 day'], 'to' => [$to, '<', '+1 day']] as $name => [$day, $operator, $shift]) {
            if (null === $day) {
                continue;
            }
            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $day, $berlin);
            if (!$date || $date->format('Y-m-d') !== $day) {
                throw new \InvalidArgumentException(\sprintf('%s must be a date like 2026-10-31.', $name));
            }
            $where[] = "received_at $operator :$name";
            $params[$name] = $date->modify($shift)->setTimezone(new \DateTimeZone('UTC'))->format(self::DB_FORMAT);
        }
        if (null !== $user) {
            if (!Uuid::isValid($user)) {
                throw new \InvalidArgumentException('user must be a UUID.');
            }
            $where[] = 'user_id = :user';
            $params['user'] = Uuid::fromString($user);
            $types['user'] = UuidType::NAME;
        }
        if (null !== $tags && null !== ($itemIds = $this->itemIds($tags))) {
            if ([] === $itemIds) {
                return $this->response([], null, [0, 0, 0, 0], $this->unfilteredEntries());
            }
            $where[] = 'timber_item_id IN (:items)';
            $params['items'] = $itemIds;
            $types['items'] = ArrayParameterType::BINARY;
        }
        $cursor = null;
        if (null !== $before) {
            if (!preg_match('/^(\d{1,20})_([0-9a-f]{32})$/', $before, $match)) {
                throw new \InvalidArgumentException('before is not a cursor of this API.');
            }
            $cursor = [(int) $match[1], hex2bin($match[2])];
        }

        [$groups, $events, $photos, $people] = $this->read($where, $params, $types);
        $totals = [\count($groups), $events, $photos, $people];
        // Without a filter the entries are the same ones: no second reading.
        $unfiltered = ['1 = 1'] === $where ? $totals[0] : $this->unfilteredEntries();

        usort($groups, static fn (array $a, array $b) => $b['first'] <=> $a['first'] ?: strcmp($b['id'], $a['id']));
        if ($cursor) {
            $groups = array_values(array_filter($groups, static fn (array $g) => $g['first'] < $cursor[0] || ($g['first'] === $cursor[0] && strcmp($g['id'], $cursor[1]) < 0)));
        }
        $page = \array_slice($groups, 0, self::PAGE_SIZE);
        $last = end($page);
        $next = \count($groups) > self::PAGE_SIZE ? $last['first'].'_'.bin2hex($last['id']) : null;

        return $this->response($page, $next, $totals, $unfiltered);
    }

    /**
     * Reads the events matching the filter and groups them into entries (see MAX_GAP_MICROSECONDS).
     *
     * @param list<string>        $where
     * @param array<string,mixed> $params
     * @param array<string,mixed> $types
     *
     * @return array{0: list<array<string, mixed>>, 1: int, 2: int, 3: int} groups in arrival order, number of events, of photos, of people
     */
    private function read(array $where, array $params, array $types): array
    {
        $connection = $this->em->getConnection();
        $photoIds = array_map(static fn (string $id) => Uuid::fromBinary($id)->toRfc4122(),
            $connection->fetchFirstColumn('SELECT id FROM attributes WHERE type = ?', [AttributeType::Photo->value]));
        $params['photoIds'] = $photoIds ?: ['-'];
        $types['photoIds'] = ArrayParameterType::STRING;
        $rows = $connection->fetchAllAssociative(
            'SELECT id, user_id, received_at,
                    (type = \'attribute_recorded\' AND JSON_VALUE(data, \'$.attribute_id\') IN (:photoIds)) AS photo
             FROM timber_item_events WHERE '.implode(' AND ', $where).' ORDER BY received_at, id',
            $params,
            $types,
        );

        $groups = [];
        $open = [];
        $photos = 0;
        $people = [];
        foreach ($rows as $row) {
            $at = self::microseconds($row['received_at']);
            $index = $open[$row['user_id']] ?? null;
            if (null === $index || $at - $groups[$index]['last'] >= self::MAX_GAP_MICROSECONDS) {
                $open[$row['user_id']] = $index = \count($groups);
                $groups[] = ['id' => $row['id'], 'user' => $row['user_id'], 'first' => $at, 'firstAt' => $row['received_at'], 'ids' => []];
            }
            $groups[$index]['last'] = $at;
            $groups[$index]['ids'][] = $row['id'];
            $photos += (int) $row['photo'];
            $people[$row['user_id']] = true;
        }

        return [$groups, \count($rows), $photos, \count($people)];
    }

    /** The number of entries over all events, formed like the ones of `totals`. */
    private function unfilteredEntries(): int
    {
        return \count($this->read(['1 = 1'], [], [])[0]);
    }

    /**
     * @return list<string>|null the ids (binary) of the stems in the range and everything below them; null for "all"
     */
    private function itemIds(string $tags): ?array
    {
        $numbers = $this->selection->parseRange($tags);
        if (false === $numbers) {
            throw new \InvalidArgumentException($this->selection->notARange($tags));
        }
        if (null === $numbers) {
            return null;
        }
        // Voided stems are included on purpose: their events are part of the history.
        $connection = $this->em->getConnection();
        $level = $connection->fetchFirstColumn('SELECT id FROM timber_items WHERE parent_id IS NULL AND tag_number IN (?)', [array_map('strval', $numbers)], [ArrayParameterType::STRING]);
        $all = $level;
        while ($level) {
            $level = $connection->fetchFirstColumn('SELECT id FROM timber_items WHERE parent_id IN (?)', [$level], [ArrayParameterType::BINARY]);
            array_push($all, ...$level);
        }

        return $all;
    }

    /**
     * @param list<array<string, mixed>> $page       groups of the requested page, newest first
     * @param int[]                      $totals     entries, events, photos, people
     * @param int                        $unfiltered entries without any filter
     *
     * @return array<string, mixed>
     */
    private function response(array $page, ?string $next, array $totals, int $unfiltered): array
    {
        $names = [];
        foreach ($this->em->getConnection()->fetchAllAssociative('SELECT id, name FROM users WHERE id IN (SELECT DISTINCT user_id FROM timber_item_events) ORDER BY name') as $user) {
            $names[$user['id']] = $user['name'];
        }
        $people = array_map(static fn (string $id) => ['id' => Uuid::fromBinary($id)->toRfc4122(), 'name' => $names[$id]], array_keys($names));

        return [
            'entries' => $page ? $this->entries($page, $names) : [],
            'next_cursor' => $next,
            'entries_unfiltered' => $unfiltered,
            'totals' => ['entries' => $totals[0], 'events' => $totals[1], 'photos' => $totals[2], 'users' => $totals[3]],
            'users' => $people,
        ];
    }

    /**
     * @param list<array<string, mixed>> $page
     * @param array<string,string>       $names user name by binary id
     *
     * @return list<array<string, mixed>>
     */
    private function entries(array $page, array $names): array
    {
        $ids = array_merge(...array_column($page, 'ids'));
        $events = $this->loadEvents($ids);
        // A voided or restored event names what it affects; a restore points to a void, which points to the original.
        for ($depth = 0; $depth < 2; ++$depth) {
            $missing = array_unique(array_filter(array_diff(array_column($events, 'reference_id'), array_keys($events))));
            if (!$missing) {
                break;
            }
            $events += $this->loadEvents($missing);
        }

        $itemIds = array_values(array_unique(array_column(array_intersect_key($events, array_flip($ids)), 'timber_item_id')));
        $items = [];
        foreach ($this->em->getConnection()->fetchAllAssociative('SELECT id, tag_number, parent_id FROM timber_items WHERE id IN (?)', [$itemIds], [ArrayParameterType::BINARY]) as $item) {
            $items[$item['id']] = $item;
        }
        $attributes = [];
        foreach ($this->em->getRepository(Attribute::class)->findAll() as $attribute) {
            $attributes[$attribute->id->toRfc4122()] = $attribute;
        }
        $labels = [];
        foreach ($this->em->getRepository(AttributeOption::class)->findAll() as $option) {
            $labels[$option->id->toRfc4122()] = $option->label;
        }

        $entries = [];
        foreach ($page as $group) {
            $changes = [];
            $order = [];
            $recorded = [];
            foreach ($group['ids'] as $id) {
                $event = $events[$id];
                $order[$event['timber_item_id']] ??= \count($order);
                $changes[$event['timber_item_id']][] = [...$this->change($event, $events, $attributes, $labels), 'recorded_at' => Timestamp::format(self::date($event['recorded_at']))];
                $recorded[] = $event['recorded_at'];
            }
            // Stem before its beams; otherwise in the order the events came in.
            $rank = static function (string $itemId) use ($order, $items): array {
                $parent = $items[$itemId]['parent_id'] ?? null;

                return [isset($order[$parent]) ? $order[$parent] : $order[$itemId], null === $parent ? 0 : 1, $order[$itemId]];
            };
            $itemIdsOfEntry = array_keys($order);
            usort($itemIdsOfEntry, static fn (string $a, string $b) => $rank($a) <=> $rank($b));

            sort($recorded);
            $entries[] = [
                'id' => Uuid::fromBinary($group['id'])->toRfc4122(),
                'received_at' => Timestamp::format(self::date($group['firstAt'])),
                'user' => ['id' => Uuid::fromBinary($group['user'])->toRfc4122(), 'name' => $names[$group['user']] ?? ''],
                'recorded_from' => Timestamp::format(self::date($recorded[0])),
                'recorded_to' => Timestamp::format(self::date(end($recorded))),
                'event_count' => \count($group['ids']),
                'items' => array_map(static fn (string $itemId) => [
                    'timber_item_id' => Uuid::fromBinary($itemId)->toRfc4122(),
                    'label' => $items[$itemId]['tag_number'] ?? 'ohne Kennung',
                    'changes' => $changes[$itemId],
                ], $itemIdsOfEntry),
            ];
        }

        return $entries;
    }

    /**
     * @param array<string, mixed>                $event
     * @param array<string, array<string, mixed>> $events     by binary id
     * @param array<string, Attribute>            $attributes by id (RFC 4122)
     * @param array<string, string>               $labels     option label by id
     *
     * @return array{kind: string, name: string, value: string} see ActivityChange in frontend/shared/contract.ts
     */
    private function change(array $event, array $events, array $attributes, array $labels): array
    {
        $data = json_decode($event['data'], true);

        switch ($event['type']) {
            case 'created':
                return ['kind' => 'created', 'name' => null === $data['parent_id'] ? 'Stamm' : 'Balken', 'value' => 'angelegt'];
            case 'tag_assigned':
                return ['kind' => 'tag', 'name' => 'Kennung', 'value' => (string) $data['tag_number']];
            case 'attribute_recorded':
                $attribute = $attributes[$data['attribute_id']];
                if (AttributeType::Photo === $attribute->type) {
                    return ['kind' => 'photo', 'name' => $attribute->name, 'value' => 'hinzugefügt'];
                }
                $value = ValueText::forDisplay($attribute, $data['value'], $labels);

                return ['kind' => 'value', 'name' => $attribute->name, 'value' => $value];
        }

        // voided or restored: the words are those of what it affects
        $verb = 'voided' === $event['type'] ? 'storniert' : 'wiederhergestellt';
        $target = $this->affected($event, $events);
        $what = $target ? $this->change($target, $events, $attributes, $labels) : null;
        // Only the assignment of one photo is voided (app:photo:move), not all photos.
        if ('voided' === $event['type'] && 'photo' === ($what['kind'] ?? null)) {
            return ['kind' => 'photo_removed', 'name' => $what['name'], 'value' => 'entfernt'];
        }

        return [
            'kind' => $event['type'],
            'name' => $what['name'] ?? 'Ereignis',
            'value' => $verb,
        ];
    }

    /**
     * The event a voided or restored event refers to; null if it cannot be found.
     *
     * @param array<string, mixed>                $event
     * @param array<string, array<string, mixed>> $events by binary id
     *
     * @return array<string, mixed>|null
     */
    private function affected(array $event, array $events): ?array
    {
        $target = $events[$event['reference_id']] ?? null;
        // A restore refers to the void it lifts; what matters is what that void had voided.
        if ('voided' === ($target['type'] ?? null) && 'restored' === $event['type']) {
            $target = $events[$target['reference_id']] ?? null;
        }

        return $target;
    }

    /**
     * @param list<string> $ids binary
     *
     * @return array<string, array<string, mixed>> by binary id
     */
    private function loadEvents(array $ids): array
    {
        $events = [];
        foreach ($this->em->getConnection()->fetchAllAssociative('SELECT id, timber_item_id, type, data, recorded_at, reference_id FROM timber_item_events WHERE id IN (?)', [$ids], [ArrayParameterType::BINARY]) as $row) {
            $events[$row['id']] = $row;
        }

        return $events;
    }

    private static function date(string $databaseValue): \DateTimeImmutable
    {
        return \DateTimeImmutable::createFromFormat(self::DB_FORMAT, $databaseValue, new \DateTimeZone('UTC'));
    }

    private static function microseconds(string $databaseValue): int
    {
        return strtotime(substr($databaseValue, 0, 19).' UTC') * 1_000_000 + (int) substr($databaseValue, 20, 6);
    }
}
