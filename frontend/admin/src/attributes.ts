import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type {
  AdminAttribute,
  AdminAttributeInput,
  AttributeType,
  ItemKind,
  Uuid,
} from '@v29/shared/contract'

import { countText } from '@/listFilters'

/** The words of the types in the settings, as V29 knows them. */
export const TYPE_LABELS: Record<AttributeType, string> = {
  choice: 'Auswahl',
  boolean: 'Ja/Nein',
  number: 'Zahl',
  text: 'Text',
  date: 'Datum',
  month: 'Monat',
  photo: 'Foto',
}

/** Only these can be a series (the server refuses it for choice and yes/no, and a photo is always one). */
export const SERIES_TYPES: AttributeType[] = ['number', 'text', 'date', 'month']

/** `?attribute=new`: the draft of a new attribute is "selected". */
export const NEW_ATTRIBUTE = 'new'

export const KIND_LABELS: Record<ItemKind, string> = { stem: 'Stamm', beam: 'Balken' }

// --- The URL: ?view=beam, ?inactive=1, ?attribute=<id> ---------------------------------------------------------------------------

export interface AttributesQuery {
  /** What the preview shows: the form of a stem or of a beam. */
  view: ItemKind
  inactive: boolean
  attribute: Uuid | null
}

export function readQuery(query: LocationQuery): AttributesQuery {
  const text = (name: string) => (typeof query[name] === 'string' ? query[name] : null)
  return {
    view: text('view') === 'beam' ? 'beam' : 'stem',
    inactive: text('inactive') === '1',
    attribute: text('attribute') || null,
  }
}

/** Only what differs from the start state goes into the URL. */
export function writeQuery({ view, inactive, attribute }: AttributesQuery): LocationQueryRaw {
  return {
    ...(view === 'beam' && { view }),
    ...(inactive && { inactive: '1' }),
    ...(attribute && { attribute }),
  }
}

// --- The preview --------------------------------------------------------------------------------------------------------------

/** In the view "Balken": an attribute of the stem alone that the beams inherit. The app shows it there without an input. */
export const isInheritedOnly = (attribute: AdminAttribute, view: ItemKind) =>
  view === 'beam' && !attribute.applies_to.includes('beam') && attribute.is_inheritable

/**
 * The attributes of the preview in their order: those offered for the kind, inactive ones only on request. `hidden_when` plays no part:
 * the preview shows every attribute of the view. On a beam the app also shows (read-only, "Vom Stamm geerbt") the attributes of the stem
 * alone that are inheritable, so the view "Balken" holds those too; stem-only attributes that are not inheritable are not on a beam at all.
 */
export const visibleAttributes = (
  attributes: AdminAttribute[],
  view: ItemKind,
  inactive: boolean,
) =>
  attributes.filter(
    (attribute) =>
      (attribute.applies_to.includes(view) || isInheritedOnly(attribute, view)) &&
      (attribute.active || inactive),
  )

export const countAttributes = (number: number) =>
  countText(number, number, false, ['Merkmal', 'Merkmale', 'Merkmalen'])

// --- The form ----------------------------------------------------------------------------------------------------------------

export interface OptionDraft {
  /** Existing option; a new one has none and is not sent with an id. */
  id?: Uuid
  /** Tells apart the rows of the list in the form (an option without id has nothing else). */
  rowId: number
  label: string
  active: boolean
}

/** What the form edits: a copy of an attribute without key and order. */
export interface AttributeDraft {
  name: string
  description: string
  type: AttributeType
  unit: string
  appliesTo: ItemKind[]
  isInheritable: boolean
  isSeries: boolean
  hiddenWhen: string[]
  active: boolean
  options: OptionDraft[]
}

let rows = 0
export const newRowId = () => ++rows

export const draftOf = (attribute: AdminAttribute): AttributeDraft => ({
  name: attribute.name,
  description: attribute.description,
  type: attribute.type,
  unit: attribute.unit ?? '',
  appliesTo: [...attribute.applies_to],
  isInheritable: attribute.is_inheritable,
  isSeries: attribute.is_series,
  hiddenWhen: [...attribute.hidden_when],
  active: attribute.active,
  options: attribute.options.map((option) => ({
    id: option.id,
    rowId: newRowId(),
    label: option.label,
    active: option.active,
  })),
})

/** The same kinds in the order of the contract and the same keys sorted, so that ticking and unticking again is no change. */
const comparable = (draft: AttributeDraft) =>
  JSON.stringify({
    ...draft,
    appliesTo: (['stem', 'beam'] as ItemKind[]).filter((kind) => draft.appliesTo.includes(kind)),
    hiddenWhen: [...draft.hiddenWhen].sort(),
    options: draft.options.map(({ id, label, active }) => ({ id, label, active })),
  })

export const sameDraft = (a: AttributeDraft, b: AttributeDraft) => comparable(a) === comparable(b)

export const isChanged = (attribute: AdminAttribute, draft: AttributeDraft) =>
  !sameDraft(draftOf(attribute), draft)

/** Another type takes along what only makes sense for the old one: the unit of a number, the series of a list. */
export function withType(draft: AttributeDraft, type: AttributeType): AttributeDraft {
  return {
    ...draft,
    type,
    unit: type === 'number' ? draft.unit : '',
    isSeries: SERIES_TYPES.includes(type) && draft.isSeries,
  }
}

/** The body of the PATCH: everything, so that the server checks the whole state. Options only for a choice. */
export function bodyOf(draft: AttributeDraft): AdminAttributeInput {
  const unit = draft.unit.trim()
  return {
    name: draft.name,
    description: draft.description,
    type: draft.type as AdminAttributeInput['type'],
    unit: draft.type === 'number' && unit ? unit : null,
    is_series: draft.isSeries,
    is_inheritable: draft.isInheritable,
    applies_to: (['stem', 'beam'] as ItemKind[]).filter((kind) => draft.appliesTo.includes(kind)),
    hidden_when: draft.hiddenWhen,
    active: draft.active,
    options:
      draft.type === 'choice'
        ? draft.options.map(({ id, label, active }) => ({ ...(id && { id }), label, active }))
        : [],
  }
}

/** The yes/no attributes of the system, the only ones another attribute can be hidden by (not the attribute itself). */
export const hidingCandidates = (attributes: AdminAttribute[], exceptId: Uuid) =>
  attributes.filter(
    (attribute) =>
      attribute.is_system &&
      attribute.key !== null &&
      attribute.type === 'boolean' &&
      attribute.id !== exceptId,
  )

/** "field → message" of a 422; the first message of a field counts. */
export function errorsOf(body: unknown): Record<string, string> {
  const list = (body as { errors?: { field: string; message: string }[] } | undefined)?.errors
  const errors: Record<string, string> = {}
  for (const { field, message } of Array.isArray(list) ? list : []) errors[field] ??= message
  return errors
}

// --- A new attribute -------------------------------------------------------------------------------------------------------------

/** The types the tiles offer: a date is a day or a month (the form asks which), the rest is one tile each. */
export type TileType = 'choice' | 'boolean' | 'number' | 'text' | 'date'

export const TILES: { type: TileType; label: string; example: string }[] = [
  { type: 'choice', label: 'Auswahl', example: 'z. B. Holzart, Länge' },
  { type: 'boolean', label: 'Ja / Nein', example: 'z. B. Entrindet' },
  { type: 'number', label: 'Zahl', example: 'z. B. Durchmesser in cm' },
  { type: 'text', label: 'Text', example: 'z. B. Bemerkung' },
  { type: 'date', label: 'Datum', example: 'z. B. Lieferdatum, Fällzeitpunkt (nur Monat)' },
]

/** The tile a type belongs to (a month is a date with the precision "Monat"). */
export const tileOf = (type: AttributeType): TileType =>
  type === 'month' ? 'date' : (type as TileType)

/** The defaults of a new attribute: valid for the view it is made in, no inheritance, no series, active; a choice starts with one empty option. */
export const newDraft = (type: AttributeType, view: ItemKind): AttributeDraft => ({
  name: '',
  description: '',
  type,
  unit: '',
  appliesTo: [view],
  isInheritable: false,
  isSeries: false,
  hiddenWhen: [],
  active: true,
  options: type === 'choice' ? [{ rowId: newRowId(), label: '', active: true }] : [],
})

/** Another type for a draft: what fits stays (name, kinds, the unit of a number, a series), the options only belong to a choice. */
export function withNewType(draft: AttributeDraft, type: AttributeType): AttributeDraft {
  const next = withType(draft, type)
  return {
    ...next,
    options:
      type !== 'choice'
        ? []
        : next.options.length
          ? next.options
          : [{ rowId: newRowId(), label: '', active: true }],
  }
}

/** The draft as an attribute, for the preview: no id of the server, no key, last in order. */
export const previewOf = (draft: AttributeDraft): AdminAttribute => ({
  id: NEW_ATTRIBUTE,
  key: null,
  name: draft.name.trim(),
  description: draft.description,
  type: draft.type,
  unit: draft.type === 'number' && draft.unit.trim() ? draft.unit.trim() : null,
  is_series: draft.isSeries,
  is_inheritable: draft.isInheritable,
  applies_to: draft.appliesTo,
  hidden_when: draft.hiddenWhen,
  sort_order: Number.MAX_SAFE_INTEGER,
  active: draft.active,
  options: [],
  is_system: false,
  has_values: false,
})

// --- The order -------------------------------------------------------------------------------------------------------------------

/** The list with the item at `from` moved to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/**
 * The whole order after the visible attributes were arranged: they take the places the visible ones had, everything else stays
 * where it was (in a view, the attributes of the other kind keep their places).
 */
export function applyVisibleOrder(
  all: AdminAttribute[],
  arranged: AdminAttribute[],
): AdminAttribute[] {
  const queue = [...arranged]
  const ids = new Set(arranged.map((attribute) => attribute.id))
  return all.map((attribute) => (ids.has(attribute.id) ? queue.shift()! : attribute))
}
