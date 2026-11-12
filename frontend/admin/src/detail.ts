import type {
  ActivityEntry,
  ActivityItem,
  Attribute,
  AttributeValueRecord,
  TimberItem,
} from '@v29/shared/contract'
import { bySortOrder, formatValue, isInheritedValue } from '@v29/shared/attributes'
import { formatTag } from '@v29/shared/tag'

import { MAX_TAG_NUMBER, formatDayMonthUnlessThisYear, sameDay, yearOf } from '@/activity'

/** "00104" → "104", "104-c" → "104-C"; null if it is no tag within the plaque range. */
export function normalizeTag(param: string): string | null {
  const match = /^0*(\d+)(?:-([A-Za-z]))?$/.exec(param.trim())
  if (!match) return null
  const number = Number(match[1])
  if (number < 1 || number > MAX_TAG_NUMBER) return null
  return match[2] ? `${number}-${match[2].toUpperCase()}` : String(number)
}

/** The stem's number of a tag: "104-C" → "104". */
export const stemNumber = (tag: string) => tag.split('-')[0]

/** The tag as printed on the plaque: "104-C" → "00104-C". */
export function plaqueTag(tag: string): string {
  const [number, letter] = tag.split('-')
  return letter ? `${formatTag(Number(number))}-${letter}` : formatTag(Number(number))
}

/** File name of a download: "00104-1.jpg", "00104-C-2.jpg" (`position` counts from 1, as in the gallery). */
export const photoFileName = (tag: string, position: number) => `${plaqueTag(tag)}-${position}.jpg`

type Named = { id: string; name: string }

export interface ValueLine {
  text: string
  /** "Alexander Summa · 29.10." or "Vom Stamm geerbt". */
  source: string
}

export interface ValueRow {
  id: string
  name: string
  /** Empty = not recorded. A series: one line per recording, newest first. */
  lines: ValueLine[]
}

/** A photo of an item: its id and the device time of the recording (the day shown in the gallery). */
export interface PhotoRecord {
  id: string
  recorded_at: string
}

export interface ItemParts {
  /** Oldest first; only the item's own. */
  photos: PhotoRecord[]
  rows: ValueRow[]
  /** Latest device time of an own value; undefined if there is none. */
  lastChanged: string | undefined
  /** Name of the person who recorded that value. */
  lastChangedBy: string | undefined
}

/**
 * Splits an item's values (as the snapshot delivers them, inherited ones included) into photos and value rows.
 * Photos come from own values only; the rows show inherited values as such, except text series (notes): a beam shows
 * only its own. Attribute names are never assumed: photos are told apart by type, notes by "text series".
 */
export function splitValues(
  item: TimberItem,
  parent: TimberItem | undefined,
  attributes: Attribute[],
  users: Named[],
): ItemParts {
  const userName = (record: AttributeValueRecord) =>
    users.find((user) => user.id === record.user_id)?.name ?? 'Unbekannt'
  const who = (record: AttributeValueRecord) =>
    `${userName(record)} · ${formatDayMonthUnlessThisYear(record.recorded_at)}`
  const line = (attribute: Attribute, record: AttributeValueRecord, inherited: boolean) => ({
    text: formatRecorded(attribute, record.value),
    source: inherited ? 'Vom Stamm geerbt' : who(record),
  })

  const photos: AttributeValueRecord[] = []
  const rows: ValueRow[] = []
  const sorted = [...attributes].sort(bySortOrder)
  const last = latestOwnRecord(item, parent, sorted)
  for (const attribute of sorted) {
    const records = item.values[attribute.id] ?? []
    const inherited = isInheritedValue(item, parent, attribute.id)
    if (attribute.type === 'photo') {
      if (!inherited) photos.push(...records)
    } else if (attribute.active || records.length) {
      // A series lists every recording, newest first; anything else holds just its current value.
      // A beam does not show the stem's notes (text series), only its own.
      const hidden = inherited && attribute.type === 'text' && attribute.is_series
      const shown = hidden
        ? []
        : attribute.is_series
          ? [...records].reverse()
          : records.slice(-1)
      rows.push({
        id: attribute.id,
        name: attribute.name,
        lines: shown.map((record) => line(attribute, record, inherited)),
      })
    }
  }
  return {
    photos: photos
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      .map((p) => ({ id: String(p.value), recorded_at: p.recorded_at })),
    rows,
    lastChanged: last?.recorded_at,
    lastChangedBy: last && userName(last),
  }
}

/** The latest own recording of an item (inherited values are its parent's): the rule behind "last changed". */
export function latestOwnRecord(
  item: TimberItem,
  parent: TimberItem | undefined,
  attributes: Attribute[],
): AttributeValueRecord | undefined {
  let last: AttributeValueRecord | undefined
  for (const attribute of attributes) {
    if (isInheritedValue(item, parent, attribute.id)) continue
    for (const record of item.values[attribute.id] ?? []) {
      if (!last || record.recorded_at > last.recorded_at) last = record
    }
  }
  return last
}

export function formatRecorded(attribute: Attribute, value: AttributeValueRecord['value']): string {
  if (attribute.type === 'boolean') return value ? 'ja' : 'nein'
  return formatValue(attribute, value) ?? String(value)
}

/** Beams of a stem in tag order. A beam without a tag cannot be opened by its tag, so it is left out (it always gets one when it is created). */
export const beamsOf = (stem: TimberItem, items: TimberItem[]) =>
  items
    .filter(
      (item): item is TimberItem & { tag_number: string } =>
        item.parent_id === stem.id && item.tag_number !== null,
    )
    .sort((a, b) => a.tag_number.localeCompare(b.tag_number))

/** Changes of one person at most this far apart belong to one point of the timeline (about one save in the app, photos added afterwards included). */
const POINT_GAP_MS = 2 * 60_000

export interface HistoryPoint {
  /** Unique: the same person cannot have two points at the same device time. */
  key: string
  /** Earliest device time of the point. */
  recordedAt: string
  user: string
  /** Latest arrival at the server, only if that was on another (German) day than `recordedAt`. */
  transferredAt: string | null
  /** The shown item first, then beams by tag (as seen from a stem only their `created` change); each with only its changes in this point, in device time order. */
  items: ActivityItem[]
}

/**
 * The timeline of the history by device time, newest point first. All changes of the asked items are sorted by `recorded_at`;
 * a point is a run of changes of the same person, each at most two minutes after the one before. `shownId` is the item the page is about;
 * of the other items (the beams of a stem) only their creation counts, filtered before grouping, so that it alone shapes points and gaps.
 */
export function historyPoints(
  entries: ActivityEntry[],
  itemIds: Set<string>,
  shownId: string,
): HistoryPoint[] {
  // Oldest entry first, so that changes with the same device time keep the order they happened in (the sort is stable).
  const changes = [...entries]
    .reverse()
    .flatMap((entry) =>
      entry.items
        .filter((item) => itemIds.has(item.timber_item_id))
        // Of a beam, the stem's history knows only that it was created; everything else is in the beam's own history.
        .flatMap((item) =>
          item.changes
            .filter((change) => item.timber_item_id === shownId || change.kind === 'created')
            .map((change) => ({ entry, item, change })),
        ),
    )
    .sort((a, b) => Date.parse(a.change.recorded_at) - Date.parse(b.change.recorded_at))

  const runs: (typeof changes)[] = []
  for (const next of changes) {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    if (
      run &&
      last &&
      last.entry.user.id === next.entry.user.id &&
      Date.parse(next.change.recorded_at) - Date.parse(last.change.recorded_at) <= POINT_GAP_MS
    ) {
      run.push(next)
    } else {
      runs.push([next])
    }
  }

  return runs
    .map((run): HistoryPoint => {
      const recordedAt = run[0].change.recorded_at
      const received = run
        .map(({ entry }) => entry.received_at)
        .reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest))
      const byItem = new Map<string, ActivityItem>()
      for (const { item, change } of run) {
        const own = byItem.get(item.timber_item_id) ?? { ...item, changes: [] }
        own.changes.push(change)
        byItem.set(item.timber_item_id, own)
      }
      return {
        key: `${recordedAt}|${run[0].entry.user.id}`,
        recordedAt,
        user: run[0].entry.user.name,
        transferredAt: sameDay(received, recordedAt) ? null : received,
        items: [...byItem.values()].sort(
          (a, b) =>
            Number(b.timber_item_id === shownId) - Number(a.timber_item_id === shownId) ||
            a.label.localeCompare(b.label),
        ),
      }
    })
    .reverse()
}

export type TimelineRow =
  | { key: string; year: number; point?: undefined }
  | { key: string; point: HistoryPoint; year?: undefined }

/**
 * The rows of the timeline: the points, newest first, with a year mark before the first point of each year –
 * unless all points lie in `thisYear`, then there are no marks at all.
 */
export function timelineRows(points: HistoryPoint[], thisYear: number): TimelineRow[] {
  const marked = points.some((point) => yearOf(point.recordedAt) !== thisYear)
  const rows: TimelineRow[] = []
  let previous: number | undefined
  for (const point of points) {
    const year = yearOf(point.recordedAt)
    if (marked && year !== previous) rows.push({ key: `year-${year}`, year })
    previous = year
    rows.push({ key: point.key, point })
  }
  return rows
}
