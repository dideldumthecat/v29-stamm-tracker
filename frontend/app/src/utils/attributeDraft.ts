import type { Attribute, AttributeValue, AttributeValueRecord } from '@v29/shared/contract'
import { bySortOrder, formatValue, MID_DIAMETER_KEYS } from '@v29/shared/attributes'
import { plural } from '@/utils/plural'

/**
 * Raw input of one field, as the field holds it: choice → option id, boolean → true/false,
 * date → "YYYY-MM-DD", month → "YYYY-MM", number/text → the text as typed. Parsed only when collecting, so half-typed input survives.
 */
export type DraftInput = string | boolean

/** One future attribute_recorded event. */
export interface DraftChange {
  attributeId: string
  value: AttributeValue
}

export interface CollectedDraft {
  changes: DraftChange[]
  /** Invalid input by attribute id. Does not appear in `changes`, but counts as unsaved. */
  errors: Record<string, string>
}

export const NUMBER_ERROR = 'Bitte eine Zahl eingeben, zum Beispiel 34,5.'
export const DIAMETER_PAIR_ERROR = 'Bitte auch diesen Durchmesser eintragen'
export const SAWN_DIAMETER_ERROR = 'Pflichtfeld bei gesägten Stämmen'
export const MONTH_ERROR = 'Bitte Jahr und Monat als JJJJ-MM eingeben, zum Beispiel 2026-10.'

/**
 * Strict on purpose: parseFloat would turn "34abc" into 34. The log is append-only,
 * so a wrong value could only be fixed by an admin.
 */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim()
  return /^-?\d+([.,]\d+)?$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : null
}

/** One line for a value, as shown on the sync screen and in the leave dialog: "Holzart: Stieleiche", "Gesägt: Nein". */
export function formatValueLine(attribute: Attribute, value: AttributeValue): string {
  const text = formatValue(attribute, value) ?? String(value)
  // Boolean values already read as a sentence ("Gesägt", "Gesägt: Nein").
  return attribute.type === 'boolean' ? text : `${attribute.name}: ${text}`
}

/** "1 Foto" / "3 Fotos", as listed in the leave and remove dialogs. */
export function formatPhotoCount(count: number): string {
  return plural(count, 'Foto', 'Fotos')
}

type Parsed = { value: AttributeValue } | { error: string } | undefined

// undefined = nothing entered. Empty input never clears a recorded value (append-only log).
function parseInput(attribute: Attribute, input: DraftInput): Parsed {
  if (typeof input === 'boolean') {
    return attribute.type === 'boolean' ? { value: input } : undefined
  }
  const text = input.trim()
  if (text === '') {
    return undefined
  }
  switch (attribute.type) {
    case 'choice':
    case 'text':
    // <input type="date"> already delivers "YYYY-MM-DD" (or "" while incomplete), nothing to parse.
    case 'date':
      return { value: text }
    case 'number': {
      const number = parseNumber(text)
      return number === null ? { error: NUMBER_ERROR } : { value: number }
    }
    // Native month pickers deliver "YYYY-MM" or "", but desktop Firefox and Safari show a plain text field.
    case 'month':
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? { value: text } : { error: MONTH_ERROR }
    default:
      return undefined
  }
}

/**
 * Turns the draft into the events to record and the fields that cannot be recorded yet.
 *
 * @param input  raw input per attribute id (undefined = untouched)
 * @param added  series only: values already added with "Hinzufügen", oldest first
 * @param recorded  the item's current values, if it exists
 */
export function collectDraft(
  attributes: Attribute[],
  input: Record<string, DraftInput | undefined>,
  added: Record<string, AttributeValue[]>,
  recorded: Record<string, AttributeValueRecord[]> | undefined,
): CollectedDraft {
  const changes: DraftChange[] = []
  const errors: Record<string, string> = {}

  for (const attribute of attributes) {
    const id = attribute.id
    if (attribute.is_series) {
      for (const value of added[id] ?? []) {
        changes.push({ attributeId: id, value })
      }
    }
    const raw = input[id]
    const parsed = raw === undefined ? undefined : parseInput(attribute, raw)
    if (!parsed) {
      continue
    }
    if ('error' in parsed) {
      errors[id] = parsed.error
      continue
    }
    // Series: the pending input becomes one more value. Otherwise only a differing value counts.
    // An unrecorded boolean is implicitly "false", so unticked stays "no change".
    const current =
      recorded?.[id]?.slice(-1)[0]?.value ?? (attribute.type === 'boolean' ? false : undefined)
    if (attribute.is_series || parsed.value !== current) {
      changes.push({ attributeId: id, value: parsed.value })
    }
  }
  return { changes, errors }
}

/**
 * The two mid diameters are saved only as a pair (a deliberate exception to "no required fields"): if the draft touches one of them
 * and only one is filled afterwards (draft, else recorded), the empty one gets the error. Items recorded with one diameter stay
 * saveable as long as the draft leaves both alone. Invalid input counts as touched and filled: its own error blocks the save anyway.
 * Returns errors by attribute id like `collectDraft`.
 */
export function missingDiameterErrors(
  attributes: Attribute[],
  collected: CollectedDraft,
  recorded: Record<string, AttributeValueRecord[]> | undefined,
): Record<string, string> {
  const ids = MID_DIAMETER_KEYS.map(
    (key) => attributes.find((attribute) => attribute.key === key && attribute.active)?.id,
  )
  if (ids.some((id) => id === undefined)) {
    return {}
  }
  const touched = ids.map(
    (id) =>
      id! in collected.errors || collected.changes.some((change) => change.attributeId === id),
  )
  const filled = ids.map((id, index) => touched[index] || (recorded?.[id!]?.length ?? 0) > 0)
  if (!touched.some(Boolean) || filled[0] === filled[1]) {
    return {}
  }
  return { [ids[filled[0] ? 1 : 0]!]: DIAMETER_PAIR_ERROR }
}

/**
 * Ids of the mid diameters that have no valid value yet, in the order of `MID_DIAMETER_KEYS`: typed in the draft,
 * added to a series, or recorded. Empty input never clears a recorded value, so a recorded one always counts.
 * Empty if either attribute is missing or inactive (the rule is skipped, like `missingDiameterErrors`).
 */
export function emptyDiameterIds(
  attributes: Attribute[],
  input: Record<string, DraftInput | undefined>,
  added: Record<string, AttributeValue[]>,
  recorded: Record<string, AttributeValueRecord[]> | undefined,
): string[] {
  const ids = MID_DIAMETER_KEYS.map(
    (key) => attributes.find((attribute) => attribute.key === key && attribute.active)?.id,
  )
  if (ids.some((id) => id === undefined)) {
    return []
  }
  return (ids as string[]).filter((id) => {
    const typed = input[id]
    return !(
      (typeof typed === 'string' && parseNumber(typed) !== null) ||
      (added[id]?.length ?? 0) > 0 ||
      (recorded?.[id]?.length ?? 0) > 0
    )
  })
}

/**
 * Recorded values as dialog lines in the order of the form, then the photos as a count
 * (photos are told apart by the attribute type). Only a series lists more than its latest value.
 */
export function formatRecordedLines(
  attributes: Attribute[],
  values: Record<string, AttributeValueRecord[] | undefined>,
): string[] {
  const lines: string[] = []
  let photoCount = 0
  for (const attribute of [...attributes].sort(bySortOrder)) {
    const recorded = values[attribute.id] ?? []
    if (attribute.type === 'photo') {
      photoCount += recorded.length
    } else {
      for (const record of attribute.is_series ? recorded : recorded.slice(-1)) {
        lines.push(formatValueLine(attribute, record.value))
      }
    }
  }
  return photoCount > 0 ? [...lines, formatPhotoCount(photoCount)] : lines
}
