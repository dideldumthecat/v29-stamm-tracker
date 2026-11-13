import type { LocationQueryRaw } from 'vue-router'
import { bySortOrder } from '@v29/shared/attributes'
import type { Attribute, ItemKind, Snapshot, TimberItem } from '@v29/shared/contract'

import { dayKey, formatDayMonthUnlessThisYear } from '@/activity'
import { formatRecorded, latestOwnRecord } from '@/detail'
import {
  countText,
  filterType,
  formatCount,
  matchesFilter,
  offersNone,
  readFilter,
  tagFilter,
  type ColumnFilter,
  type RowFilter,
} from '@/listFilters'

/**
 * Pure logic of the list of stems (and, with `kind` "beam", of beams): columns from the attributes, rows from the snapshot, cell values,
 * sorting and the URL. Nothing here knows an attribute by name or key: columns and cells follow type and definition. The filters
 * and their texts are in `listFilters.ts`.
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
  /** The tags of those beams ("104-A"): what the "Kennung" filter looks at for a beam tag. */
  beamTags: string[]
  /** Latest own recording, otherwise the creation: same rule as the detail view. */
  changed: string
  /** The German calendar day of `changed`, "2026-10-31". */
  changedDay: string
  /** Name of the person behind `changed`; undefined if the snapshot does not know them. */
  changedBy: string | undefined
}

/** A row with the value of every cell, by column id: worked out once per snapshot, shown and sorted by as they are. */
export interface Row extends RawRow {
  cells: Record<string, Cell>
}

/**
 * Tag, one column per active attribute of the kind (V29 order), for stems the number of beams, last change.
 * The first column is called "Stamm" or "Balken" like the kind; a stem list shows no column for beams of beams.
 */
export function buildColumns(attributes: Attribute[], kind: ItemKind): Column[] {
  return [
    {
      id: 'tag',
      kind: 'tag',
      label: kind === 'stem' ? 'Stamm' : 'Balken',
      align: 'left',
      wraps: false,
    },
    ...attributes
      .filter((attribute) => attribute.active && attribute.applies_to.includes(kind))
      .sort(bySortOrder)
      .map((attribute): Column => ({
        id: attribute.id,
        kind: 'attribute',
        label: attribute.name,
        attribute,
        align: attribute.type === 'number' || attribute.type === 'photo' ? 'right' : 'left',
        wraps: attribute.type === 'text' || attribute.type === 'choice',
      })),
    ...(kind === 'stem'
      ? [{ id: 'beams', kind: 'beams', label: 'Balken', align: 'right', wraps: false } as Column]
      : []),
    { id: 'changed', kind: 'changed', label: 'Geändert', align: 'left', wraps: false },
  ]
}

/** One row per stem (or per beam), with its cells; in a list of stems the beams are no rows, they only count. */
export function buildRows(
  snapshot: Snapshot,
  kind: ItemKind,
  columns: Column[] = buildColumns(snapshot.attributes, kind),
): Row[] {
  return withCells(rawRows(snapshot, kind), columns)
}

/** The rows with the value of every cell. */
export function withCells(rows: RawRow[], columns: Column[]): Row[] {
  return rows.map((row) => ({
    ...row,
    cells: Object.fromEntries(columns.map((column) => [column.id, cellOf(row, column)])),
  }))
}

function rawRows(snapshot: Snapshot, kind: ItemKind): RawRow[] {
  const beams = new Map<string, TimberItem[]>()
  for (const item of snapshot.timber_items) {
    if (item.parent_id) beams.set(item.parent_id, [...(beams.get(item.parent_id) ?? []), item])
  }
  return snapshot.timber_items
    .filter((item) => (item.parent_id === null) === (kind === 'stem'))
    .map((item) => {
      // Like the detail view: the person of the latest own recording, without one the person who created the stem
      const last = latestOwnRecord(item, undefined, snapshot.attributes)
      const userId = last?.user_id ?? item.created_by
      const changed = last?.recorded_at ?? item.created_at
      return {
        item,
        beams: beams.get(item.id)?.length ?? 0,
        beamTags: (beams.get(item.id) ?? []).flatMap((beam) => beam.tag_number ?? []),
        changed,
        changedDay: dayKey(changed),
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

/** The column filters of the URL in column order; `filter` is null for one that cannot be read. */
export function columnFilters(
  query: ListQuery,
  columns: Column[],
): { column: Column; filter: ColumnFilter | null }[] {
  return columns.flatMap((column) => {
    const type = filterType(column)
    const text = query.filters[column.id]
    return type && text ? [{ column, filter: readFilter(type, text, offersNone(column)) }] : []
  })
}

/** The filters the URL asks for (the "Kennung" and the columns); null if one of them cannot be read. */
export function filtersFor(query: ListQuery, columns: Column[]): RowFilter[] | null {
  const filters: RowFilter[] = []
  if (query.tags) {
    const filter = tagFilter(query.tags)
    if (!filter) return null
    filters.push(filter)
  }
  for (const { column, filter } of columnFilters(query, columns)) {
    if (!filter) return null
    filters.push((row) => matchesFilter(row, column, filter))
  }
  return filters
}

/** "130 Stämme", with a filter "34 von 130 Stämmen". */
export const stemsText = (shown: number, total: number, filtered: boolean) =>
  countText(shown, total, filtered, ['Stamm', 'Stämme', 'Stämmen'])

/**
 * The state of the list as the URL holds it: `tags`, the column filters as written by `writeFilter` (`f.<column id>`, here by column id)
 * and `sort` (a column id) with `dir`.
 */
export interface ListQuery {
  tags: string
  filters: Record<string, string>
  sort: string
  dir: 'asc' | 'desc'
}

/** Reads the URL; a `sort` or filter of a column that does not exist (any more) is ignored. */
export function readQuery(query: LocationQueryRaw, columns: Column[]): ListQuery {
  const first = (name: string) => String([query[name]].flat()[0] ?? '')
  const sort = first('sort')
  const filters: Record<string, string> = {}
  for (const column of columns) {
    const text = first(`f.${column.id}`).trim()
    if (text && filterType(column)) filters[column.id] = text
  }
  return {
    tags: first('tags').trim(),
    filters,
    sort: columns.some((column) => column.id === sort) ? sort : 'tag',
    dir: first('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** The URL of a state: what is the default (all stems, by tag, ascending) is left out. */
export function writeQuery({ tags, filters, sort, dir }: ListQuery): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (tags) query.tags = tags
  for (const [id, text] of Object.entries(filters)) query[`f.${id}`] = text
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
