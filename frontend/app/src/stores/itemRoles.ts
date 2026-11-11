/**
 * Which attributes an item offers for input. App-only rules: the server accepts any event (applies_to is not enforced there).
 * Pure functions, so the rules can be tested without the store.
 */
import type { Attribute, ItemKind, Snapshot } from '@v29/shared/contract'

/** Keys of the attributes the rules refer to (never their names, which V29 may change). */
export const SAWN_KEY = 'sawn'
export const NOTES_KEY = 'notes'

/**
 * A snapshot stored by an app version from before `key`, `applies_to` and `hidden_when` lacks these fields, and it stays
 * on the device until the next download succeeds. With these defaults the app behaves as it did then:
 * every attribute everywhere, no split question (no key "sawn").
 */
export function withAttributeDefaults(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    attributes: snapshot.attributes.map((attribute) => ({
      ...attribute,
      key: attribute.key ?? null,
      applies_to: attribute.applies_to ?? ['stem', 'beam'],
      hidden_when: attribute.hidden_when ?? [],
    })),
  }
}

/**
 * What became of a sawn stem: 'whole' = "Nicht aufgeteilt" (it is its own beam), 'split' = "Mehrere Balken".
 * Never stored or synced: it follows from the state (see `splitChoiceOf`).
 */
export type SplitChoice = 'whole' | 'split'

export interface ItemRoles {
  kinds: ItemKind[]
  /** A stem that is or will be split: only what `isOpenOnSplitStem` allows can still be recorded. */
  locked: boolean
}

export interface ItemState {
  /** The item has a parent. */
  isBeam: boolean
  /** "Gesägt: ja", as the form shows it (draft over recorded). */
  sawn: boolean
  /** Beams saved or in the draft. */
  hasBeams: boolean
  choice: SplitChoice | null
}

export function itemRoles({ isBeam, sawn, hasBeams, choice }: ItemState): ItemRoles {
  if (isBeam) {
    return { kinds: ['beam'], locked: false }
  }
  // Also stems with beams from before the choice existed, whatever "Gesägt" says.
  if (hasBeams || (sawn && choice === 'split')) {
    return { kinds: ['stem'], locked: true }
  }
  return { kinds: sawn && choice === 'whole' ? ['stem', 'beam'] : ['stem'], locked: false }
}

/**
 * The choice as the form shows it. Beams decide, saved or in the draft: without any, a sawn stem counts as not split,
 * also after "Mehrere Balken" was picked and the last draft beam removed again (to split after all, beams are added again).
 * null = not sawn, or sawn without an answer (the form asks before "Gesägt" enters the draft).
 */
export function splitChoiceOf(state: {
  sawn: boolean
  recordedSawn: boolean
  hasSavedBeams: boolean
  draftBeamCount: number
  picked: SplitChoice | null
}): SplitChoice | null {
  if (!state.sawn) {
    return null
  }
  if (state.hasSavedBeams || state.draftBeamCount > 0) {
    return 'split'
  }
  return state.picked || state.recordedSawn ? 'whole' : null
}

/** What the rule `hidden_when` needs to know about the item. */
export interface YesValues {
  /** The attribute with this key stands on "ja" as the form shows it: draft over recorded, own over inherited. */
  isYes: (key: string) => boolean
  /**
   * The attribute itself is recorded as "ja". The draft does not count: taking the "ja" back must not hide the field
   * (and drop that input) before it is saved.
   */
  recordedYes: boolean
}

/**
 * An attribute is not offered while one of the attributes it names in `hidden_when` stands on "ja".
 * Its own recorded "ja" keeps it open: two contradicting "ja" from the data can then be resolved in the app
 * instead of locking each other.
 */
export function isHiddenByOthers(
  attribute: Pick<Attribute, 'hidden_when'>,
  { isYes, recordedYes }: YesValues,
): boolean {
  return !recordedYes && attribute.hidden_when.some(isYes)
}

/**
 * What a split stem still takes. The lock keeps what describes the sawn timber (cross-section, length, photos) off the stem,
 * so it covers exactly the attributes the beams take too. Attributes of the stem alone stay open: sawyers add the diameters
 * after splitting. The notes stay open as well: the one place to say something about the stem as a whole.
 * "Gesägt" follows its own rule: it can be taken back only while every beam is still a draft.
 */
export function isOpenOnSplitStem(
  attribute: Pick<Attribute, 'key' | 'applies_to'>,
  hasSavedBeams: boolean,
): boolean {
  if (attribute.key === SAWN_KEY) {
    return !hasSavedBeams
  }
  return attribute.key === NOTES_KEY || !attribute.applies_to.includes('beam')
}

export function isEditable(
  attribute: Pick<Attribute, 'key' | 'active' | 'applies_to' | 'hidden_when'>,
  roles: ItemRoles,
  hasSavedBeams: boolean,
  yes: YesValues,
): boolean {
  return (
    attribute.active &&
    attribute.applies_to.some((kind) => roles.kinds.includes(kind)) &&
    !isHiddenByOthers(attribute, yes) &&
    (!roles.locked || isOpenOnSplitStem(attribute, hasSavedBeams))
  )
}

/**
 * hasValue for `fieldMode`. The "nein" of a yes/no attribute hidden by others counts as empty:
 * it says nothing the "ja" of the other attribute does not say already.
 */
export function keepsField(
  attribute: Pick<Attribute, 'type'>,
  hasValue: boolean,
  hiddenByOthers: boolean,
): boolean {
  return hasValue && !(hiddenByOthers && attribute.type === 'boolean')
}

export type FieldMode = 'input' | 'readonly' | 'hidden'

/** One rule for every field type. hasValue: own or inherited. An empty field that cannot be filled is not shown. */
export function fieldMode(editable: boolean, hasValue: boolean): FieldMode {
  return editable ? 'input' : hasValue ? 'readonly' : 'hidden'
}
