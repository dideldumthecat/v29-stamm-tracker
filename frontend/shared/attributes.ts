/**
 * Pure helpers for attributes and their values, shared by the capture app and the administration.
 */
import type { Attribute, AttributeValue, AttributeValueRecord, TimberItem } from './contract'

/** Key of the attribute "Gesägt": "ja" on a stem without beams means it was sawn whole (the app asks the split question by it, the administration lists such stems as beams). */
export const SAWN_KEY = 'sawn'

/** Keys of the two mid diameters of a stem ("Stammmittendurchmesser groß" and "klein"): the app takes them only as a pair. */
export const MID_DIAMETER_KEYS = ['mid_diameter_max', 'mid_diameter_min'] as const

/** Key of the attribute "Nicht sägbar": a stem with the checkmark counts as processed. */
export const UNSAWABLE_KEY = 'unsawable'

/** Key of the cross-section: one recorded on the stem itself means it was sawn whole. */
export const CROSS_SECTION_KEY = 'sawn_cross_section'

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

/**
 * The value that counts for an item: the latest recorded one. A yes/no attribute without a value counts as "nein" (as in the app,
 * `attributeDraft.ts`) – if it applies to the item (`applies`: the kind of the item is in `applies_to`); otherwise, and for every other type,
 * undefined means "not recorded". The one place for this rule: lists, filters and the detail view all ask here.
 */
export function currentValue(
  attribute: Attribute,
  records: AttributeValueRecord[] | undefined,
  applies: boolean,
): AttributeValue | undefined {
  return (
    records?.slice(-1)[0]?.value ?? (attribute.type === 'boolean' && applies ? false : undefined)
  )
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

/** The latest value of the attribute with this key on the item; undefined = not recorded, or there is no such attribute. */
function valueOfKey(item: Pick<TimberItem, 'values'>, attributes: Attribute[], key: string) {
  const id = attributes.find((attribute) => attribute.key === key)?.id
  return id ? item.values[id]?.slice(-1)[0]?.value : undefined
}

/** Whether a yes/no attribute (by key) stands on "ja" for the item; no value or no such attribute is "nein". */
export const isMarked = (item: Pick<TimberItem, 'values'>, attributes: Attribute[], key: string) =>
  valueOfKey(item, attributes, key) === true

/** Whether the item has any value for the attribute with this key. */
export const hasValueOfKey = (
  item: Pick<TimberItem, 'values'>,
  attributes: Attribute[],
  key: string,
) => valueOfKey(item, attributes, key) !== undefined

/**
 * The diameter class of a stem, as `from_cm` (classes of two whole cm: 32 and 33 cm are 32, shown "32–33 cm"); null without a diameter.
 * The same rule as the server (`KeyFigures::diameterClass`, tested with the same cases): the mean of both diameters, rounded commercially
 * to whole cm (half up: 32.5 → 33); with only one recorded it counts for both; 0 or less is not measured.
 */
export function diameterClass(max: unknown, min: unknown): number | null {
  const known = (value: unknown) => (typeof value === 'number' && value > 0 ? value : null)
  const a = known(max) ?? known(min)
  const b = known(min) ?? known(max)
  if (a === null || b === null) return null
  // Rounded to 6 places first, so that float noise does not turn 32.5 into 32.4999…
  const whole = Math.round(Math.round(((a + b) / 2) * 1e6) / 1e6)
  return Math.floor(whole / 2) * 2
}

/** The diameter class of a stem from its values (the attributes are found by key); null without a diameter. */
export const diameterClassOf = (item: Pick<TimberItem, 'values'>, attributes: Attribute[]) =>
  diameterClass(
    valueOfKey(item, attributes, MID_DIAMETER_KEYS[0]),
    valueOfKey(item, attributes, MID_DIAMETER_KEYS[1]),
  )

/** A class as V29 reads it: from_cm 32 → "32–33 cm". */
export const formatDiameterClass = (fromCm: number) => `${fromCm}–${fromCm + 1} cm`
