import type { Attribute, AttributeValue, AttributeValueRecord } from '@/api/contract'
import { formatDate, formatMonth } from '@/utils/date'

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
export const MONTH_ERROR = 'Bitte Jahr und Monat als JJJJ-MM eingeben, zum Beispiel 2026-10.'

/**
 * Strict on purpose: parseFloat would turn "34abc" into 34. The log is append-only,
 * so a wrong value could only be fixed by an admin.
 */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim()
  return /^-?\d+([.,]\d+)?$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : null
}

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

/** One line for a value, as shown on the sync screen and in the leave dialog: "Holzart: Stieleiche", "Gesägt: Nein". */
export function formatValueLine(attribute: Attribute, value: AttributeValue): string {
  const text = formatValue(attribute, value) ?? String(value)
  // Boolean values already read as a sentence ("Gesägt", "Gesägt: Nein").
  return attribute.type === 'boolean' ? text : `${attribute.name}: ${text}`
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
