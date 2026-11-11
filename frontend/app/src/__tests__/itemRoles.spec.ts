import { describe, it, expect } from 'vitest'
import type { ItemKind } from '@v29/shared/contract'
import { fieldMode, isEditable, itemRoles, splitChoiceOf } from '@/stores/itemRoles'

const stem = { isBeam: false, sawn: false, hasBeams: false, choice: null }

describe('itemRoles', () => {
  it('is a stem only while the stem is not sawn', () => {
    expect(itemRoles(stem)).toEqual({ kinds: ['stem'], locked: false })
  })

  it('stays a stem only while "Gesägt" has no answer yet', () => {
    expect(itemRoles({ ...stem, sawn: true })).toEqual({ kinds: ['stem'], locked: false })
  })

  it('is stem and beam when sawn as a whole', () => {
    expect(itemRoles({ ...stem, sawn: true, choice: 'whole' })).toEqual({
      kinds: ['stem', 'beam'],
      locked: false,
    })
  })

  it('is a locked stem from the choice "Mehrere Balken" on, before any beam is saved', () => {
    expect(itemRoles({ ...stem, sawn: true, choice: 'split' })).toEqual({
      kinds: ['stem'],
      locked: true,
    })
  })

  it('is a locked stem with beams, also without "Gesägt" (stems split before the choice existed)', () => {
    expect(itemRoles({ ...stem, hasBeams: true })).toEqual({ kinds: ['stem'], locked: true })
  })

  it('is a beam only with a parent, whatever it inherits', () => {
    expect(itemRoles({ ...stem, isBeam: true, sawn: true })).toEqual({
      kinds: ['beam'],
      locked: false,
    })
  })
})

describe('splitChoiceOf', () => {
  const state = {
    sawn: true,
    recordedSawn: false,
    hasSavedBeams: false,
    draftBeamCount: 0,
    picked: null,
  }

  it('has no choice without "Gesägt"', () => {
    expect(
      splitChoiceOf({ ...state, sawn: false, hasSavedBeams: true, picked: 'split' }),
    ).toBeNull()
  })

  it('has no choice for a sawn stem that neither was recorded as sawn nor got an answer', () => {
    expect(splitChoiceOf(state)).toBeNull()
  })

  it('opens a stem recorded as sawn without beams as "Nicht aufgeteilt"', () => {
    expect(splitChoiceOf({ ...state, recordedSawn: true })).toBe('whole')
  })

  it('opens a sawn stem with beams as "Mehrere Balken", whatever was picked', () => {
    expect(splitChoiceOf({ ...state, hasSavedBeams: true, picked: 'whole' })).toBe('split')
  })

  it('is "Mehrere Balken" with draft beams', () => {
    expect(splitChoiceOf({ ...state, draftBeamCount: 2, picked: 'split' })).toBe('split')
  })

  it('falls back to "Nicht aufgeteilt" after the last draft beam is removed', () => {
    expect(splitChoiceOf({ ...state, picked: 'split' })).toBe('whole')
  })
})

describe('isEditable and fieldMode', () => {
  const attribute = (applies_to: ItemKind[], key: string | null = null, active = true) => ({
    key,
    active,
    applies_to,
  })
  const unsawn = itemRoles(stem)
  const whole = itemRoles({ ...stem, sawn: true, choice: 'whole' })
  const split = itemRoles({ ...stem, sawn: true, choice: 'split' })
  const beam = itemRoles({ ...stem, isBeam: true })

  it('offers an attribute where it fits a role of the item', () => {
    expect(isEditable(attribute(['stem']), unsawn, false)).toBe(true)
    expect(isEditable(attribute(['beam']), unsawn, false)).toBe(false)
    expect(isEditable(attribute(['beam']), whole, false)).toBe(true)
    expect(isEditable(attribute(['stem']), whole, false)).toBe(true)
    expect(isEditable(attribute(['beam']), beam, false)).toBe(true)
    expect(isEditable(attribute(['stem']), beam, false)).toBe(false)
    expect(isEditable(attribute(['stem', 'beam']), beam, false)).toBe(true)
  })

  it('never offers an inactive attribute', () => {
    expect(isEditable(attribute(['stem'], null, false), unsawn, false)).toBe(false)
  })

  it('leaves a locked stem what only stems take, the notes, and "Gesägt" until a beam is saved', () => {
    for (const hasSavedBeams of [false, true]) {
      expect(isEditable(attribute(['stem']), split, hasSavedBeams)).toBe(true)
      expect(isEditable(attribute(['stem', 'beam']), split, hasSavedBeams)).toBe(false)
      expect(isEditable(attribute(['beam']), split, hasSavedBeams)).toBe(false)
    }
    // A stem with beams from before the choice existed is locked without "Gesägt: ja".
    const legacy = itemRoles({ ...stem, hasBeams: true })
    expect(isEditable(attribute(['stem']), legacy, true)).toBe(true)
    expect(isEditable(attribute(['stem', 'beam']), legacy, true)).toBe(false)
    expect(isEditable(attribute(['stem'], 'sawn'), legacy, true)).toBe(false)
    expect(isEditable(attribute(['stem'], 'sawn'), split, false)).toBe(true)
    expect(isEditable(attribute(['stem'], 'sawn'), split, true)).toBe(false)
    expect(isEditable(attribute(['stem', 'beam'], 'notes'), split, false)).toBe(true)
    expect(isEditable(attribute(['stem', 'beam'], 'notes'), split, true)).toBe(true)
  })

  it('shows what cannot be recorded read-only with a value and not at all without', () => {
    expect(fieldMode(true, false)).toBe('input')
    expect(fieldMode(true, true)).toBe('input')
    expect(fieldMode(false, true)).toBe('readonly')
    expect(fieldMode(false, false)).toBe('hidden')
  })
})
