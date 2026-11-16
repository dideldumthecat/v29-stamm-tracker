/**
 * Pure helpers for attributes and their values, shared by the capture app and the administration.
 */
import type { Attribute, AttributeValue, AttributeValueRecord, TimberItem } from './contract'

/** Key of the attribute "Gesägt": "ja" on a stem without beams means it was sawn whole (the app asks the split question by it, the administration lists such stems as beams). */
export const SAWN_KEY = 'sawn'

/** Compare function for attributes and options: V29 maintains the order via `sort_order`. */
export const bySortOrder = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order

/** Contract date "2026-09-28" → "28.09.2026", the way V29 writes dates. */
export function formatDate(calendarDate: string): string {
  return calendarDate.split('-').reverse().join('.')
}

/** Contract month "2026-10" → "10/2026", the way V29 writes it. */
export function formatMonth(calendarMonth: string): string {
  return calendarMonth.split('-').reverse().join('/')
}

/** Contract month "2026-10" → "Oktober 2026", for lists of months (tables and details stay with `formatMonth`). */
export const formatMonthLong = (calendarMonth: string): string =>
  new Date(`${calendarMonth}-01T00:00:00Z`).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** Number as V29 writes it: decimal comma. */
export function formatNumber(value: number): string {
  return String(value).replace('.', ',')
}

/** Short text of a recorded value, e.g. for the beam summary. null for types without text (photo). */
export function formatValue(attribute: Attribute, value: AttributeValue): string | null {
  switch (attribute.type) {
    case 'choice':
      return attribute.options.find((option) => option.id === value)?.label ?? null
    case 'boolean':
      return value ? attribute.name : `${attribute.name}: Nein`
    case 'number':
      return [formatNumber(Number(value)), attribute.unit ?? ''].join(' ').trim()
    case 'date':
      return formatDate(String(value))
    case 'month':
      return formatMonth(String(value))
    case 'text':
      return String(value)
    default:
      return null
  }
}

/** The event behind the latest recording of a value list. */
export const lastEventId = (records: AttributeValueRecord[] | undefined) =>
  records?.slice(-1)[0]?.event_id

/**
 * Inherited = the beam shows the very recording its parent holds. `item` must carry its inherited values
 * (as the snapshot delivers them).
 */
export function isInheritedValue(
  item: Pick<TimberItem, 'values'>,
  parent: Pick<TimberItem, 'values'> | undefined,
  attributeId: string,
): boolean {
  const own = lastEventId(item.values[attributeId])
  return (
    parent !== undefined && own !== undefined && own === lastEventId(parent.values[attributeId])
  )
}

/**
 * Short info of a beam row: its first two own values in the order V29 set (inherited ones are the stem's, not worth
 * repeating). `beam` undefined = a draft beam that is not saved yet.
 */
export function beamSummary(
  beam: TimberItem | undefined,
  stem: Pick<TimberItem, 'values'> | undefined,
  attributes: Attribute[],
): string {
  const parts = beam
    ? [...attributes]
        .sort(bySortOrder)
        .filter(
          (attribute) => beam.values[attribute.id] && !isInheritedValue(beam, stem, attribute.id),
        )
        .map((attribute) => formatValue(attribute, beam.values[attribute.id]!.slice(-1)[0]!.value))
        .filter((text) => text !== null)
        .slice(0, 2)
    : []
  return parts.length > 0 ? parts.join(' · ') : 'noch keine eigenen Angaben'
}
