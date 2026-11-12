import type { LocationQueryRaw } from 'vue-router'
import { bySortOrder } from '@v29/shared/attributes'
import type { Attribute, Snapshot, TimberItem } from '@v29/shared/contract'

import { countText, formatCount, formatDayMonthUnlessThisYear, parseTagRanges } from '@/activity'
import { formatRecorded, latestOwnRecord } from '@/detail'

/**
 * Pure logic of the stem list: columns from the attributes, rows from the snapshot, cell values, sorting, filters and
 * the URL. Nothing here knows an attribute by name or key: columns and cells follow type and definition.
 */

/** `id` is what `sort` in the URL holds: "tag", "beams", "changed" or the id of the attribute. */
export interface Column {
  id: string
  kind: 'tag' | 'attribute' | 'beams' | 'changed'
  label: string
  attribute?: Attribute
  align: 'left' | 'right'
  /** Text and choices wrap at word boundaries (two lines at most); everything else stays on one line. */
  wraps: boolean
}

/** What a row is made of before its cells are worked out. */
export interface RawRow {
  item: TimberItem
  /** Number of beams cut from the stem. */
  beams: number
  /** Latest own recording, otherwise the creation: same rule as the detail view. */
  changed: string
  /** Name of the person behind `changed`; undefined if the snapshot does not know them. */
  changedBy: string | undefined
}

/** A row with the value of every cell, by column id: worked out once per snapshot, shown and sorted by as they are. */
export interface Row extends RawRow {
  cells: Record<string, Cell>
}

/** Stem, one column per active attribute of stems (V29 order), beams, last change. */
export function buildColumns(attributes: Attribute[]): Column[] {
  return [
    { id: 'tag', kind: 'tag', label: 'Stamm', align: 'left', wraps: false },
    ...attributes
      .filter((attribute) => attribute.active && attribute.applies_to.includes('stem'))
      .sort(bySortOrder)
      .map((attribute): Column => ({
        id: attribute.id,
        kind: 'attribute',
        label: attribute.name,
        attribute,
        align: attribute.type === 'number' || attribute.type === 'photo' ? 'right' : 'left',
        wraps: attribute.type === 'text' || attribute.type === 'choice',
      })),
    { id: 'beams', kind: 'beams', label: 'Balken', align: 'right', wraps: false },
    { id: 'changed', kind: 'changed', label: 'Geändert', align: 'left', wraps: false },
  ]
}

/** One row per stem, with its cells; beams are no rows, they only count. */
export function buildRows(
  snapshot: Snapshot,
  columns: Column[] = buildColumns(snapshot.attributes),
): Row[] {
  return withCells(rawRows(snapshot), columns)
}

/** The rows with the value of every cell. */
export function withCells(rows: RawRow[], columns: Column[]): Row[] {
  return rows.map((row) => ({
    ...row,
    cells: Object.fromEntries(columns.map((column) => [column.id, cellOf(row, column)])),
  }))
}

function rawRows(snapshot: Snapshot): RawRow[] {
  const beams = new Map<string, number>()
  for (const item of snapshot.timber_items) {
    if (item.parent_id) beams.set(item.parent_id, (beams.get(item.parent_id) ?? 0) + 1)
  }
  return snapshot.timber_items
    .filter((item) => item.parent_id === null)
    .map((item) => {
      // Like the detail view: the person of the latest own recording, without one the person who created the stem
      const last = latestOwnRecord(item, undefined, snapshot.attributes)
      const userId = last?.user_id ?? item.created_by
      return {
        item,
        beams: beams.get(item.id) ?? 0,
        changed: last?.recorded_at ?? item.created_at,
        changedBy: snapshot.users.find((user) => user.id === userId)?.name,
      }
    })
}

/** `text` null = not recorded ("–"); `key` is what the column is sorted by (null = not recorded, always last, see `sortRows`). */
export interface Cell {
  text: string | null
  key: number | null
  /** A series: the number of older recordings, shown as "(+n)" behind the text. */
  more?: number
  /** "Geändert": the person, shown under the date. */
  by?: string
}

const NOT_RECORDED: Cell = { text: null, key: null }

/** The value of a cell: for a series the latest recording, a note with the number of older ones behind it. */
export function cellOf(row: RawRow, column: Column): Cell {
  switch (column.kind) {
    case 'tag':
      return row.item.tag_number === null
        ? NOT_RECORDED
        : { text: row.item.tag_number, key: Number.parseInt(row.item.tag_number) }
    case 'beams':
      return { text: formatCount(row.beams), key: row.beams }
    case 'changed':
      return {
        text: formatDayMonthUnlessThisYear(row.changed),
        key: Date.parse(row.changed),
        by: row.changedBy,
      }
  }
  const attribute = column.attribute!
  const records = row.item.values[attribute.id] ?? []
  const last = records[records.length - 1]
  if (!last) return NOT_RECORDED
  switch (attribute.type) {
    case 'photo':
      return { text: formatCount(records.length), key: records.length }
    case 'boolean':
      // "ja" before "nein"
      return { text: last.value ? 'ja' : 'nein', key: last.value ? 0 : 1 }
    case 'choice': {
      const option = attribute.options.find((candidate) => candidate.id === last.value)
      return option ? { text: option.label, key: option.sort_order } : NOT_RECORDED
    }
    case 'number':
      return { text: formatRecorded(attribute, last.value), key: Number(last.value) }
    case 'date':
    case 'month':
      return { text: formatRecorded(attribute, last.value), key: Date.parse(String(last.value)) }
    case 'text': {
      const text = String(last.value)
      // Texts are sorted by whether there is one, not by what it says: all values equal, the stem number decides
      return { text, key: 0, more: attribute.is_series ? records.length - 1 : 0 }
    }
  }
}

/**
 * Sorts by one column. A value that is not recorded comes last in both directions – except in a text column, which is
 * sorted by whether there is a text (see `cellOf`): there "none" counts as the greatest, last ascending and first descending.
 * The cells are those of the rows, not worked out again. A tie (also between two values that are not recorded) is decided by the stem number, ascending in both directions
 * (stems without tag last, then the order of the snapshot).
 */
export function sortRows(rows: Row[], column: Column, dir: 'asc' | 'desc'): Row[] {
  const sign = dir === 'desc' ? -1 : 1
  const emptyLast = column.attribute?.type !== 'text'
  const tag = (row: Row) => row.cells.tag.key ?? Infinity
  return [...rows].sort((a, b) => {
    const byTag = tag(a) === tag(b) ? 0 : tag(a) < tag(b) ? -1 : 1
    const keyA = a.cells[column.id].key
    const keyB = b.cells[column.id].key
    if (keyA === keyB) return byTag
    if (keyA === null) return emptyLast ? 1 : sign
    if (keyB === null) return emptyLast ? -1 : -sign
    return sign * (keyA - keyB) || byTag
  })
}

/** A filter keeps the rows it returns true for; all filters of a list must hold (step 2 adds one per column). */
export type RowFilter = (row: Row) => boolean

export const applyFilters = (rows: Row[], filters: RowFilter[]) =>
  rows.filter((row) => filters.every((filter) => filter(row)))

/** The filter of the "Kennung" field; null if the text is not readable. */
export function tagFilter(text: string): RowFilter | null {
  const ranges = parseTagRanges(text)
  if (!ranges) return null
  return ({ item }) => {
    if (item.tag_number === null) return false
    const number = Number.parseInt(item.tag_number)
    return ranges.some(([from, to]) => number >= from && number <= to)
  }
}

/** The filters the URL asks for; null if one of them cannot be read. */
export function filtersFor(query: ListQuery): RowFilter[] | null {
  const filters: RowFilter[] = []
  if (query.tags) {
    const filter = tagFilter(query.tags)
    if (!filter) return null
    filters.push(filter)
  }
  return filters
}

/** "130 Stämme", with a filter "34 von 130 Stämmen". */
export const stemsText = (shown: number, total: number, filtered: boolean) =>
  countText(shown, total, filtered, ['Stamm', 'Stämme', 'Stämmen'])

/** The state of the list as the URL holds it: `tags` and `sort` (a column id) with `dir`. */
export interface ListQuery {
  tags: string
  sort: string
  dir: 'asc' | 'desc'
}

/** Reads the URL; a `sort` that is no column is ignored. */
export function readQuery(query: LocationQueryRaw, columns: Column[]): ListQuery {
  const first = (name: string) => String([query[name]].flat()[0] ?? '')
  const sort = first('sort')
  return {
    tags: first('tags').trim(),
    sort: columns.some((column) => column.id === sort) ? sort : 'tag',
    dir: first('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** The URL of a state: what is the default (all stems, by tag, ascending) is left out. */
export function writeQuery({ tags, sort, dir }: ListQuery): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (tags) query.tags = tags
  if (sort !== 'tag') query.sort = sort
  if (dir === 'desc') query.dir = 'desc'
  return query
}

/** A click on a header: the same column flips the direction, another one starts ascending. */
export const sortBy = (state: ListQuery, columnId: string): ListQuery =>
  state.sort === columnId
    ? { ...state, dir: state.dir === 'asc' ? 'desc' : 'asc' }
    : { ...state, sort: columnId, dir: 'asc' }

/** A heading word of up to this many characters is never hyphenated ("Polternummer" is 12, "Fällzeitpunkt" 13). */
export const MAX_UNBROKEN_WORD_LENGTH = 14

/** The words of a column heading; `hyphenate` says whether the browser may break the word with hyphenation (only long ones). */
export function headingWords(label: string): { text: string; hyphenate: boolean }[] {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, hyphenate: text.length > MAX_UNBROKEN_WORD_LENGTH }))
}
