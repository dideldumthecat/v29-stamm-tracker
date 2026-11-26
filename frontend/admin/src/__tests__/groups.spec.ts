import { describe, expect, it } from 'vitest'
import type { AdminAttribute, AdminGroup } from '@/api/contract'

import {
  attributeMeta,
  attributesText,
  bodyOf,
  defaultGroup,
  draftOf,
  isChanged,
  newDraft,
} from '@/groups'

const group = (patch: Partial<AdminGroup> = {}): AdminGroup => ({
  id: 'g1',
  name: 'Sägewerk',
  sees_all_attributes: false,
  attribute_ids: ['a', 'b'],
  users: [],
  ...patch,
})

describe('attributesText', () => {
  it('says "Alle" or how many of all', () => {
    expect(attributesText(group({ sees_all_attributes: true, attribute_ids: [] }), 14)).toBe('Alle')
    expect(attributesText(group(), 14)).toBe('2 von 14')
  })
})

describe('attributeMeta', () => {
  const attribute = (patch: Partial<AdminAttribute>) =>
    ({
      type: 'choice',
      unit: null,
      applies_to: ['stem'],
      is_series: false,
      active: true,
      ...patch,
    }) as AdminAttribute

  it('names the type, where it is recorded, a series and an inactive attribute', () => {
    expect(attributeMeta(attribute({}))).toBe('Auswahl · Stamm')
    expect(
      attributeMeta(
        attribute({ type: 'number', unit: '%', applies_to: ['beam'], is_series: true }),
      ),
    ).toBe('Zahl (%) · Balken · mehrere Werte')
    expect(
      attributeMeta(attribute({ type: 'text', applies_to: ['stem', 'beam'], active: false })),
    ).toBe('Text · Stamm, Balken · inaktiv')
  })

  it('does not call the series of a photo one', () => {
    expect(
      attributeMeta(attribute({ type: 'photo', applies_to: ['stem', 'beam'], is_series: true })),
    ).toBe('Foto · Stamm, Balken')
  })
})

describe('defaultGroup', () => {
  it('is the group named "V29" that sees all, else the first', () => {
    const v29 = group({ id: 'v', name: 'V29', sees_all_attributes: true })
    expect(defaultGroup([group(), v29])).toBe(v29)
    expect(defaultGroup([group({ name: 'V29' }), group({ id: 'g2', name: 'Zimmerei' })])?.id).toBe(
      'g1',
    )
    expect(defaultGroup([])).toBeUndefined()
  })
})

describe('the draft', () => {
  it('starts as the group and is changed by name, choice or selection', () => {
    expect(isChanged(group(), draftOf(group()))).toBe(false)
    expect(isChanged(group(), { ...draftOf(group()), name: ' Sägewerk ' })).toBe(false)
    expect(isChanged(group(), { ...draftOf(group()), name: 'Sägerei' })).toBe(true)
    expect(isChanged(group(), { ...draftOf(group()), seesAll: true })).toBe(true)
    expect(isChanged(group(), { ...draftOf(group()), selected: ['b', 'a'] })).toBe(false)
    expect(isChanged(group(), { ...draftOf(group()), selected: ['a'] })).toBe(true)
    expect(isChanged(group(), { ...draftOf(group()), selected: ['a', 'c'] })).toBe(true)
  })

  it('ignores the selection while the group sees all', () => {
    const all = group({ sees_all_attributes: true, attribute_ids: [] })
    expect(isChanged(all, { ...draftOf(all), selected: ['a'] })).toBe(false)
  })

  it('sends no attributes for a group that sees all', () => {
    expect(bodyOf({ name: 'V29', seesAll: true, selected: ['a'] })).toEqual({
      name: 'V29',
      sees_all_attributes: true,
      attribute_ids: [],
    })
    expect(bodyOf({ name: 'Forst', seesAll: false, selected: ['a'] })).toEqual({
      name: 'Forst',
      sees_all_attributes: false,
      attribute_ids: ['a'],
    })
  })

  it('starts a new group with only the selected and none of them', () => {
    expect(newDraft()).toEqual({ name: '', seesAll: false, selected: [] })
  })
})
