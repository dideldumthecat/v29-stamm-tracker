/**
 * Reading the values of a stem or beam by the keys of attributes, for lists, filters and the detail view of the administration.
 */
import type {
  Attribute,
  AttributeValue,
  AttributeValueRecord,
  TimberItem,
} from '@v29/shared/contract'

/** Key of the attribute "Nicht sägbar": a stem with the checkmark counts as processed. */
export const UNSAWABLE_KEY = 'unsawable'

/** Key of the cross-section: one recorded on the stem itself means it was sawn whole. */
export const CROSS_SECTION_KEY = 'sawn_cross_section'

/** Contract month "2026-10" → "Oktober 2026", for lists of months (tables and details stay with `formatMonth`). */
export const formatMonthLong = (calendarMonth: string): string =>
  new Date(`${calendarMonth}-01T00:00:00Z`).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

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

/** The latest value of the attribute with this key on the item; undefined = not recorded, or there is no such attribute. */
export function valueOfKey(item: Pick<TimberItem, 'values'>, attributes: Attribute[], key: string) {
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
