import type { Attribute, AttributeValue, AttributeValueRecord } from '@/api/contract'
import { parseDate } from '@/utils/date'

/**
 * Raw input of one field, as the field holds it: choice → option id, boolean → true/false,
 * date/number/text → the text as typed. Parsed only when collecting, so half-typed input survives.
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

const DATE_ERROR = 'Bitte als TT.MM.JJJJ eingeben, zum Beispiel 28.09.2026.'
const NUMBER_ERROR = 'Bitte eine Zahl eingeben, zum Beispiel 34,5.'

/**
 * Strict on purpose: parseFloat would turn "34abc" into 34. The log is append-only,
 * so a wrong value could only be fixed by an admin.
 */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim()
  return /^-?\d+([.,]\d+)?$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : null
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
      return { value: text }
    case 'date': {
      const date = parseDate(text)
      return date ? { value: date } : { error: DATE_ERROR }
    }
    case 'number': {
      const number = parseNumber(text)
      return number === null ? { error: NUMBER_ERROR } : { value: number }
    }
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
