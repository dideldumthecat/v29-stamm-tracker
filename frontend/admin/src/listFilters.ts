import { bySortOrder, formatDate, formatMonth, formatNumber } from '@v29/shared/attributes'
import type { Attribute, AttributeType, TimberItem } from '@v29/shared/contract'

/**
 * Logic that the lists of stems, beams and the activity share: counting texts, the "Kennung" filter and the filters of the columns
 * with their chip texts. Nothing here knows an attribute by name or key, and nothing is tied to stems: what a column offers follows
 * from its type, and the columns themselves come from `buildColumns(attributes, kind)`.
 */

const number = new Intl.NumberFormat('de-DE')

export const formatCount = (n: number) => number.format(n)

export const plural = (n: number, one: string, many: string) =>
  `${formatCount(n)} ${n === 1 ? one : many}`

/**
 * "130 Stämme"; with a filter "34 von 130 Stämmen". The count after "von" is in the dative (`manyAfterVon`), which
 * differs from the plural for "Stämme" and "Einträge". Without a filter, `total` is the count.
 */
export const countText = (
  shown: number,
  total: number,
  filtered: boolean,
  [one, many, manyAfterVon]: [string, string, string],
) =>
  filtered
    ? `${formatCount(shown)} von ${plural(total, one, manyAfterVon)}`
    : plural(total, one, many)

// --- "Kennung" ----------------------------------------------------------------------------------------------------

export const MAX_TAG_NUMBER = 1999

/** What a "Kennung" filter names: numbers and ranges (`ranges`, they also mean the beams of the stems) and single beams ("104-A"). */
export interface Tags {
  ranges: [number, number][]
  beams: string[]
}

/**
 * Reads a "Kennung" filter as the server reads it (`ActivityLog::itemIds`, numbers and ranges as `StemSelection::parseRange`): parts joined by commas,
 * each a number (104), a range (100-120, numbers 1 to 1999) or a beam tag (a number and a letter, with or without hyphen, any case:
 * 104-A, 104a; no ranges of beams), blanks and leading zeros ignored; "all" alone means every number. Null if it is not readable.
 */
export function parseTags(text: string): Tags | null {
  if (text.trim() === 'all') return { ranges: [[1, MAX_TAG_NUMBER]], beams: [] }
  const tags: Tags = { ranges: [], beams: [] }
  for (const part of text.split(',')) {
    const beam = /^\s*0*(\d+)\s*-?\s*([A-Za-z])\s*$/.exec(part)
    if (beam && Number(beam[1]) >= 1 && Number(beam[1]) <= MAX_TAG_NUMBER) {
      tags.beams.push(`${Number(beam[1])}-${beam[2].toUpperCase()}`)
      continue
    }
    const match = /^\s*0*(\d+)\s*(?:-\s*0*(\d+)\s*)?$/.exec(part)
    if (!match) return null
    const from = Number(match[1])
    const to = Number(match[2] ?? match[1])
    if (from < 1 || from > to || to > MAX_TAG_NUMBER) return null
    tags.ranges.push([from, to])
  }
  return tags
}

/** Whether the server would read this "Kennung" filter. Used to search while typing only for input that is complete. */
export const isReadableTags = (text: string) => parseTags(text) !== null

// --- Filters of the columns ---------------------------------------------------------------------------------------

/** What the filters need to know of a column; the columns of the lists (`Column`, stemlist.ts) have it. */
export interface FilterColumn {
  id: string
  kind: 'tag' | 'attribute' | 'beams' | 'changed'
  label: string
  attribute?: Attribute
}

/** What the filters need to know of a row; the rows of the lists (`Row`, stemlist.ts) have it. */
export interface FilterRow {
  item: TimberItem
  /** Number of beams cut from the stem. */
  beams: number
  /** The tags of those beams ("104-A"); empty for a beam. */
  beamTags: string[]
  /** The German calendar day of the last change, "2026-10-31". */
  changedDay: string
  /** The value of every cell by column id; `text` null = not recorded. */
  cells: Record<string, { text: string | null }>
}

/** A filter keeps the rows it returns true for; all filters of a list must hold. */
export type RowFilter = (row: FilterRow) => boolean

export const applyFilters = <R extends FilterRow>(rows: R[], filters: RowFilter[]): R[] =>
  rows.filter((row) => filters.every((filter) => filter(row)))

/**
 * The filter of the "Kennung" field; null if the text is not readable. A number or range finds the stems (or beams) of those numbers;
 * a beam tag finds the beam itself and the stem that has a beam of that tag (beams of voided items are not in the snapshot).
 */
export function tagFilter(text: string): RowFilter | null {
  const tags = parseTags(text)
  if (!tags) return null
  return ({ item, beamTags }) => {
    if (item.tag_number === null) return false
    const number = Number.parseInt(item.tag_number)
    return (
      tags.ranges.some(([from, to]) => number >= from && number <= to) ||
      tags.beams.some((beam) => beam === item.tag_number || beamTags.includes(beam))
    )
  }
}

/** The type a column is filtered as: the type of the attribute, "count" for the beams; "Geändert" is filtered by day like a date. */
export type FilterType = AttributeType | 'count'

/** null: the column has no filter ("Stamm" has the field "Kennung"). */
export function filterType(column: FilterColumn): FilterType | null {
  switch (column.kind) {
    case 'tag':
      return null
    case 'beams':
      return 'count'
    case 'changed':
      return 'date'
    default:
      return column.attribute!.type
  }
}

/** The pick for "not recorded" in a `pick` filter. Further picks: option ids (choice), "yes" and "no" (boolean). */
export const NOT_RECORDED_PICK = 'none'

/**
 * What is set for one column. `pick`: choice or boolean, any of the picks; `range`: number, month, date, count, "from" and "to"
 * included, one of them may be empty, in the form of the URL ("30.5", "2026-10", "2026-10-31"); `contains`: text, a part of a word;
 * `has`: text with a text, photo with photos; `none`: not recorded (photo: without photos).
 */
export type ColumnFilter =
  | { kind: 'pick'; picks: string[] }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'contains'; text: string }
  | { kind: 'has' }
  | { kind: 'none' }

/** Whether `text` is a calendar day "2026-10-31". */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  // "2026-02-30" rolls over to March: not a day
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
}

/** One end of a range as typed or as in the URL, in the form of the URL; null if it is not readable. Month: typed "10/2026", in the URL "2026-10". */
export function readBound(type: FilterType, text: string): string | null {
  switch (type) {
    case 'number':
      return /^-?\d+(?:[.,]\d+)?$/.test(text) ? String(Number(text.replace(',', '.'))) : null
    case 'count':
      return /^\d+$/.test(text) ? String(Number(text)) : null
    case 'date':
      return isDay(text) ? text : null
    case 'month': {
      const typed = /^(0?[1-9]|1[0-2])\/(\d{4})$/.exec(text)
      if (typed) return `${typed[2]}-${typed[1].padStart(2, '0')}`
      return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text) ? text : null
    }
    default:
      return null
  }
}

/** An end of a range as V29 writes it: decimal comma, "28.09.2026", "10/2026". */
export function boundText(type: FilterType, value: string): string {
  switch (type) {
    case 'number':
      return formatNumber(Number(value))
    case 'date':
      return formatDate(value)
    case 'month':
      return formatMonth(value)
    default:
      return value
  }
}

/** Whether the filter of the column offers "Nicht erfasst" (all but a count, and "Geändert", which every item has). */
export const offersNone = (column: FilterColumn) =>
  column.kind !== 'beams' && column.kind !== 'changed'

/** The filter a URL value stands for; null if it is not readable for this type. `allowNone`: whether "none" is a filter of the column (`offersNone`). */
export function readFilter(
  type: FilterType,
  text: string,
  allowNone: boolean = type !== 'count',
): ColumnFilter | null {
  switch (type) {
    case 'choice':
    case 'boolean': {
      const picks = [...new Set(text.split(','))]
      const known = (pick: string) =>
        type === 'choice' ? /^\S+$/.test(pick) : ['yes', 'no', NOT_RECORDED_PICK].includes(pick)
      return picks.every(known) ? { kind: 'pick', picks } : null
    }
    case 'number':
    case 'month':
    case 'date':
    case 'count': {
      if (text === 'none') return allowNone ? { kind: 'none' } : null
      const parts = text.split('~')
      if (parts.length !== 2 || !text.replace('~', '')) return null
      const [from, to] = parts.map((part) => (part ? readBound(type, part) : ''))
      return from === null || to === null ? null : { kind: 'range', from, to }
    }
    case 'text': {
      if (text === 'has') return { kind: 'has' }
      if (text === 'none') return { kind: 'none' }
      const contains = /^contains:(.*\S.*)$/.exec(text)
      return contains ? { kind: 'contains', text: contains[1].trim() } : null
    }
    case 'photo':
      return text === 'has' ? { kind: 'has' } : text === 'none' ? { kind: 'none' } : null
  }
}

/** The URL value of a filter, the opposite of `readFilter`. */
export function writeFilter(filter: ColumnFilter): string {
  switch (filter.kind) {
    case 'pick':
      return filter.picks.join(',')
    case 'range':
      return `${filter.from}~${filter.to}`
    case 'contains':
      return `contains:${filter.text}`
    default:
      return filter.kind
  }
}

/** Whether the column has a value in the row. The cell shows "–" exactly for what is not recorded, so the filter and the table cannot disagree. */
const recorded = (row: FilterRow, column: FilterColumn) => row.cells[column.id].text !== null

const lastValue = (row: FilterRow, attribute: Attribute) =>
  row.item.values[attribute.id]?.slice(-1)[0]?.value

/**
 * Whether a row passes the filter of a column. Only the item's own values count (the notes of the beams of a stem never do);
 * for a series the filter looks at the latest value, as the column does – except "contains", which looks at every text of the series.
 */
export function matchesFilter(row: FilterRow, column: FilterColumn, filter: ColumnFilter): boolean {
  const attribute = column.attribute
  switch (filter.kind) {
    case 'none':
      return !recorded(row, column)
    case 'has':
      return recorded(row, column)
    case 'contains': {
      const needle = filter.text.toLowerCase()
      return (row.item.values[attribute!.id] ?? []).some((record) =>
        String(record.value).toLowerCase().includes(needle),
      )
    }
    case 'pick': {
      if (!recorded(row, column)) return filter.picks.includes(NOT_RECORDED_PICK)
      const value = lastValue(row, attribute!)
      return filter.picks.includes(
        attribute!.type === 'boolean' ? (value ? 'yes' : 'no') : String(value),
      )
    }
    case 'range': {
      if (!recorded(row, column)) return false
      const value =
        column.kind === 'beams'
          ? String(row.beams)
          : column.kind === 'changed'
            ? row.changedDay
            : String(lastValue(row, attribute!))
      // Numbers compare as numbers; days and months are written so that comparing the text is comparing the time
      const numeric = filterType(column) === 'number' || filterType(column) === 'count'
      const at = (text: string) => (numeric ? Number(text) : text) as number
      return (
        (!filter.from || at(value) >= at(filter.from)) && (!filter.to || at(value) <= at(filter.to))
      )
    }
  }
}

/** What a pick filter offers for the column: the options of the attribute in V29 order (inactive ones only if a row still has them), or "ja" and "nein". */
export function pickOptions(
  column: FilterColumn,
  rows: FilterRow[],
): { id: string; label: string }[] {
  const attribute = column.attribute!
  if (attribute.type === 'boolean') {
    return [
      { id: 'yes', label: 'ja' },
      { id: 'no', label: 'nein' },
    ]
  }
  return [...attribute.options]
    .sort(bySortOrder)
    .filter(
      (option) => option.active || rows.some((row) => lastValue(row, attribute) === option.id),
    )
    .map(({ id, label }) => ({ id, label }))
}

// --- Chips --------------------------------------------------------------------------------------------------------

/**
 * One active filter as the chip of the results bar shows it. `id` is what opens and removes it (the column id, "tags",
 * "range", "user"), `name` the name of the filter ("Polternummer"), `text` the whole chip text ("Polternummer: 03, 04").
 */
export interface FilterChip {
  id: string
  name: string
  text: string
}

/** From this many picks on, a chip no longer lists them. */
const MAX_LISTED_PICKS = 2

/** The picks of a chip: "03, 04", from three on "3 ausgewählt". `count` can be more than `labels` (picks that are no longer offered). */
export const describePicks = (labels: string[], count: number) =>
  count > MAX_LISTED_PICKS ? `${count} ausgewählt` : labels.join(', ')

/** The chip of a column filter: "Polternummer: 03, 04", "Stammmittendurchmesser groß: 30–40 cm", "Gesägt: ja", "Notiz: enthält krumm". */
export function chipOf(column: FilterColumn, filter: ColumnFilter): FilterChip {
  const type = filterType(column)!
  return {
    id: column.id,
    name: column.label,
    text: `${column.label}: ${describeValue(column, type, filter)}`,
  }
}

function describeValue(column: FilterColumn, type: FilterType, filter: ColumnFilter): string {
  switch (filter.kind) {
    case 'none':
      return type === 'photo' ? 'ohne Fotos' : 'Nicht erfasst'
    case 'has':
      return type === 'photo' ? 'mit Fotos' : 'vorhanden'
    case 'contains':
      return `enthält ${filter.text}`
    case 'pick': {
      // Every option of the attribute, not only the offered ones: a filter in the URL may name an inactive one
      const all =
        type === 'boolean'
          ? pickOptions(column, [])
          : [...column.attribute!.options].sort(bySortOrder)
      return describePicks(
        [
          ...all.filter((option) => filter.picks.includes(option.id)).map((option) => option.label),
          ...(filter.picks.includes(NOT_RECORDED_PICK) ? ['Nicht erfasst'] : []),
        ],
        filter.picks.length,
      )
    }
    case 'range': {
      const unit = column.attribute?.unit ? ` ${column.attribute.unit}` : ''
      const from = filter.from && boundText(type, filter.from)
      const to = filter.to && boundText(type, filter.to)
      if (from && to) return `${from}–${to}${unit}`
      return from ? `ab ${from}${unit}` : `bis ${to}${unit}`
    }
  }
}
