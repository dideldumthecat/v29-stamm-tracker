import type { LocationQueryRaw } from 'vue-router'
import {
  bySortOrder,
  currentValue,
  diameterClassOf,
  formatDiameterClass,
  isInheritedValue,
  MID_DIAMETER_KEYS,
} from '@v29/shared/attributes'
import type {
  Attribute,
  AttributeValueRecord,
  ItemKind,
  Snapshot,
  TimberItem,
} from '@v29/shared/contract'

import { dayKey, formatDayMonthUnlessThisYear } from '@/activity'
import { formatRecorded, isProcessed, kindsOf, latestOwnRecord } from '@/detail'
import {
  countText,
  filterType,
  formatCount,
  matchesFilter,
  NOT_RECORDED_PICK,
  offersNone,
  readFilter,
  tagFilter,
  type ColumnFilter,
  type RowFilter,
} from '@/listFilters'

/**
 * Pure logic of the list of stems (`kind` "stem", "Stämme") and of beams (`kind` "beam", "Balken"): columns from the attributes, rows from the snapshot, cell values,
 * sorting and the URL. Nothing here knows an attribute by name or key: columns and cells follow type and definition. The filters
 * and their texts are in `listFilters.ts`.
 */

/** `id` is what `sort` in the URL holds: "tag", "diameter", "processed", "beams", "changed" or the id of the attribute. */
export interface Column {
  id: string
  kind: 'tag' | 'attribute' | 'diameter' | 'processed' | 'beams' | 'changed'
  label: string
  attribute?: Attribute
  align: 'left' | 'right'
  /** Text and choices wrap at word boundaries (two lines at most); everything else stays on one line. */
  wraps: boolean
}

/** What a row is made of before its cells are worked out. */
export interface RawRow {
  item: TimberItem
  /**
   * What the row shows and filters by: the effective values of the item (own or inherited, as the snapshot has them), except the notes
   * (text series) it only inherits, which the detail view does not show either.
   */
  values: Record<string, AttributeValueRecord[]>
  /** Number of beams cut from the stem. */
  beams: number
  /** `from_cm` of the diameter class of a stem; null without a diameter (and for a beam, which has none). */
  diameterClass: number | null
  /** Whether the stem counts as processed, as on the dashboard (`isProcessed`); false for a beam. */
  processed: boolean
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
 * Tag, one column per active attribute of the kind (V29 order), for stems the diameter class, whether processed and the number of beams, last change.
 * The class stands right behind the later of the columns of the two mid diameters (by key), without them (inactive) right before "Bearbeitet".
 * The first column is called "Stamm" or "Balken" like the kind; a stem list shows no column for beams of beams.
 */
export function buildColumns(attributes: Attribute[], kind: ItemKind): Column[] {
  const fromAttributes = attributes
    .filter((attribute) => attribute.active && attribute.applies_to.includes(kind))
    .sort(bySortOrder)
    .map((attribute): Column => ({
      id: attribute.id,
      kind: 'attribute',
      label: attribute.name,
      attribute,
      align: attribute.type === 'number' || attribute.type === 'photo' ? 'right' : 'left',
      wraps: attribute.type === 'text' || attribute.type === 'choice',
    }))
  const diameters = fromAttributes.map((column) =>
    (MID_DIAMETER_KEYS as readonly (string | null)[]).includes(column.attribute!.key),
  )
  const afterDiameters = diameters.lastIndexOf(true) + 1 || fromAttributes.length
  return [
    {
      id: 'tag',
      kind: 'tag',
      label: kind === 'stem' ? 'Stamm' : 'Balken',
      align: 'left',
      wraps: false,
    },
    ...(kind === 'stem'
      ? [
          ...fromAttributes.slice(0, afterDiameters),
          {
            id: 'diameter',
            kind: 'diameter',
            label: 'Mittendurchmesser',
            align: 'left',
            wraps: false,
          } as Column,
          ...fromAttributes.slice(afterDiameters),
          {
            id: 'processed',
            kind: 'processed',
            label: 'Bearbeitet',
            align: 'left',
            wraps: false,
          } as Column,
          { id: 'beams', kind: 'beams', label: 'Balken', align: 'right', wraps: false } as Column,
        ]
      : fromAttributes),
    { id: 'changed', kind: 'changed', label: 'Geändert', align: 'left', wraps: false },
  ]
}

/** One row per stem (kind "stem") or per beam and stem sawn whole (kind "beam"), with its cells; in a list of stems the beams are no rows, they only count. */
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
  const byId = new Map(snapshot.timber_items.map((item) => [item.id, item]))
  const beams = new Map<string, TimberItem[]>()
  for (const item of snapshot.timber_items) {
    if (item.parent_id) beams.set(item.parent_id, [...(beams.get(item.parent_id) ?? []), item])
  }
  return snapshot.timber_items
    .filter((item) =>
      kind === 'stem'
        ? item.parent_id === null
        : kindsOf(item, snapshot.attributes).includes('beam'),
    )
    .map((item) => {
      const parent = item.parent_id ? byId.get(item.parent_id) : undefined
      // Like the detail view: the person of the latest own recording, without one the person who created the item
      const last = latestOwnRecord(item, parent, snapshot.attributes)
      const userId = last?.user_id ?? item.created_by
      const changed = last?.recorded_at ?? item.created_at
      const hidden = new Set(
        snapshot.attributes
          .filter(
            (attribute) =>
              attribute.type === 'text' &&
              attribute.is_series &&
              isInheritedValue(item, parent, attribute.id),
          )
          .map((attribute) => attribute.id),
      )
      const beamCount = beams.get(item.id)?.length ?? 0
      return {
        item,
        values: Object.fromEntries(Object.entries(item.values).filter(([id]) => !hidden.has(id))),
        beams: beamCount,
        diameterClass: kind === 'stem' ? diameterClassOf(item, snapshot.attributes) : null,
        processed: kind === 'stem' && isProcessed(item, beamCount, snapshot.attributes),
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
  /** "Mittendurchmesser" ("32") and "Bearbeitet" ("yes", "no"): what the pick filter of the column compares. */
  pick?: string
}

const NOT_RECORDED: Cell = { text: null, key: null }

/** What a tag is sorted by: the number, then the letter of a beam (104 < 104-A < 104-B < 105; no tag is not recorded). */
const tagKey = (tag: string) => {
  const [number, letter] = tag.split('-')
  // 100 per number: room for the 26 letters
  return Number(number) * 100 + (letter ? letter.charCodeAt(0) - 64 : 0)
}

/** The value of a cell: for a series the latest recording, a note with the number of older ones behind it. */
export function cellOf(row: RawRow, column: Column): Cell {
  switch (column.kind) {
    case 'tag':
      return row.item.tag_number === null
        ? NOT_RECORDED
        : { text: row.item.tag_number, key: tagKey(row.item.tag_number) }
    case 'diameter':
      return row.diameterClass === null
        ? NOT_RECORDED
        : {
            text: formatDiameterClass(row.diameterClass),
            key: row.diameterClass,
            pick: String(row.diameterClass),
          }
    case 'processed':
      // "ja" before "nein", like a yes/no attribute
      return row.processed
        ? { text: 'ja', key: 0, pick: 'yes' }
        : { text: 'nein', key: 1, pick: 'no' }
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
  const records = row.values[attribute.id] ?? []
  // The columns are those of the list's kind, so the attribute applies to every row of it
  const value = currentValue(attribute, records, true)
  if (value === undefined) return NOT_RECORDED
  switch (attribute.type) {
    case 'photo':
      return { text: formatCount(records.length), key: records.length }
    case 'boolean':
      // "ja" before "nein"
      return { text: value ? 'ja' : 'nein', key: value ? 0 : 1 }
    case 'choice': {
      const option = attribute.options.find((candidate) => candidate.id === value)
      return option ? { text: option.label, key: option.sort_order } : NOT_RECORDED
    }
    case 'number':
      return { text: formatRecorded(attribute, value), key: Number(value) }
    case 'date':
    case 'month':
      return { text: formatRecorded(attribute, value), key: Date.parse(String(value)) }
    case 'text': {
      const text = String(value)
      // Texts are sorted by whether there is one, not by what it says: all values equal, the stem number decides
      return { text, key: 0, more: attribute.is_series ? records.length - 1 : 0 }
    }
  }
}

/**
 * Sorts by one column. A value that is not recorded comes last in both directions – except in a text column, which is
 * sorted by whether there is a text (see `cellOf`): there "none" counts as the greatest, last ascending and first descending.
 * The cells are those of the rows, not worked out again. A tie (also between two values that are not recorded) is decided by the tag (number, then letter), ascending in both directions
 * (items without tag last, then the order of the snapshot).
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

/** "130 Stämme", with a filter "34 von 130 Stämmen"; for beams "130 Balken", "34 von 130 Balken". */
export const itemsText = (kind: ItemKind, shown: number, total: number, filtered: boolean) =>
  countText(
    shown,
    total,
    filtered,
    kind === 'stem' ? ['Stamm', 'Stämme', 'Stämmen'] : ['Balken', 'Balken', 'Balken'],
  )

/**
 * The state of the list as the program holds it: `tags`, the column filters as written by `writeFilter` (by column id, a choice by option id)
 * and `sort` (a column id) with `dir`. The URL holds the same with names instead of ids (see `urlNames`).
 */
export interface ListQuery {
  tags: string
  filters: Record<string, string>
  sort: string
  dir: 'asc' | 'desc'
}

// --- URL names ----------------------------------------------------------------------------------------------------
// The URL says `Holzart=Eiche,Kiefer&sort=Länge`. A name that would be ambiguous (see below) is replaced by the id, which always works
// (and is what older links hold). Why the id and not an escape or a suffix: it is already unique, needs no second rule to read, and an
// ambiguous name is a rare case that nobody reads in a link anyway. Why all of the clashing names and not all but the first: the link
// must not change its meaning when V29 reorders attributes.

const trimmed = (label: string) => label.normalize('NFC').trim()

/** Words of the URL that are not names of columns: the parameters and the ids of the fixed columns (an old `sort=beams`). */
const URL_WORDS = ['tags', 'sort', 'dir']

/**
 * The URL name of every column by column id. Fixed columns ("Balken", "Geändert") keep their heading; an attribute gets its name unless it is
 * empty, a parameter of the URL (`tags`, `sort`, `dir`), the heading or id of a fixed column or the name of another attribute.
 */
export function urlNames(columns: Column[]): Record<string, string> {
  const fixed = columns.filter((column) => column.kind !== 'attribute')
  const taken = new Set([
    ...URL_WORDS,
    ...fixed.flatMap((column) => [column.id, trimmed(column.label)]),
  ])
  const count = new Map<string, number>()
  for (const column of columns)
    count.set(trimmed(column.label), (count.get(trimmed(column.label)) ?? 0) + 1)
  return Object.fromEntries(
    columns.map((column) => {
      const name = trimmed(column.label)
      const usable =
        column.kind !== 'attribute' || (name && !taken.has(name) && count.get(name) === 1)
      return [column.id, usable ? name : column.id]
    }),
  )
}

/**
 * The URL name of every option of a choice attribute by option id: the label, unless it is empty, holds a comma (the separator), is "none"
 * (the word for "Nicht erfasst") or is the label of another option; then the id.
 */
function optionNames(attribute: Attribute): Record<string, string> {
  const count = new Map<string, number>()
  for (const { label } of attribute.options)
    count.set(trimmed(label), (count.get(trimmed(label)) ?? 0) + 1)
  return Object.fromEntries(
    attribute.options.map(({ id, label }) => {
      const name = trimmed(label)
      const usable =
        name && !name.includes(',') && name !== NOT_RECORDED_PICK && count.get(name) === 1
      return [id, usable ? name : id]
    }),
  )
}

/** The picks of a choice filter with `translate` applied to every option, "none" and what is unknown left alone; null drops the pick. */
const mapPicks = (text: string, translate: (pick: string) => string | null) =>
  text
    .split(',')
    .flatMap((pick) => (pick === NOT_RECORDED_PICK ? pick : (translate(pick) ?? [])))
    .join(',')

/** Reads the URL; a `sort`, filter or option that does not exist (any more) is ignored. Names and ids (old links) both work. */
export function readQuery(query: LocationQueryRaw, columns: Column[]): ListQuery {
  const first = (name: string) => String([query[name]].flat()[0] ?? '')
  const names = urlNames(columns)
  const sort = first('sort').trim()
  const filters: Record<string, string> = {}
  for (const column of columns) {
    const type = filterType(column)
    if (!type) continue
    let text = (first(names[column.id]) || first(`f.${column.id}`)).trim()
    // An old link with a range of months ("2026-10~2026-11") sets no filter
    if (type === 'month' && text.includes('~')) continue
    // An old link with "Nicht erfasst" for a yes/no attribute: that value is gone (no value counts as "nein")
    if (type === 'boolean')
      text = text
        .split(',')
        .filter((pick) => pick !== NOT_RECORDED_PICK)
        .join(',')
    if (type === 'choice') {
      const ids = new Set(column.attribute!.options.map((option) => option.id))
      const byName = new Map(
        Object.entries(optionNames(column.attribute!)).map(([id, name]) => [name, id]),
      )
      text = mapPicks(text, (pick) => byName.get(pick.trim()) ?? (ids.has(pick) ? pick : null))
    }
    if (text) filters[column.id] = text
  }
  return {
    tags: first('tags').trim(),
    filters,
    sort:
      columns.find((column) => names[column.id] === sort)?.id ??
      (columns.some((column) => column.id === sort) ? sort : 'tag'),
    dir: first('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** The URL of a state: what is the default (all stems, by tag, ascending) is left out. */
export function writeQuery(
  { tags, filters, sort, dir }: ListQuery,
  columns: Column[],
): LocationQueryRaw {
  const names = urlNames(columns)
  const query: LocationQueryRaw = {}
  if (tags) query.tags = tags
  for (const column of columns) {
    let text = filters[column.id]
    if (!text) continue
    if (filterType(column) === 'choice') {
      const optionName = optionNames(column.attribute!)
      text = mapPicks(text, (pick) => optionName[pick] ?? pick)
    }
    query[names[column.id]] = text
  }
  if (sort !== 'tag') query.sort = names[sort] ?? sort
  if (dir === 'desc') query.dir = 'desc'
  return query
}

/**
 * The URL query of the list of stems with the stems a row of the dashboard card "Stämme nach Mittendurchmesser" counts: processed ones of the class
 * `fromCm`, or without a diameter (null).
 */
export const processedStemsLink = (fromCm: number | null) =>
  writeQuery(
    {
      tags: '',
      filters: { processed: 'yes', diameter: fromCm === null ? NOT_RECORDED_PICK : String(fromCm) },
      sort: 'tag',
      dir: 'asc',
    },
    buildColumns([], 'stem'),
  )

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
