import { describe, expect, it } from 'vitest'
import type { AdminAttribute, ItemKind } from '@v29/shared/contract'

import {
  applyVisibleOrder,
  bodyOf,
  countAttributes,
  draftOf,
  errorsOf,
  isInheritedOnly,
  isChanged,
  moveItem,
  newDraft,
  previewOf,
  readQuery,
  tileOf,
  visibleAttributes,
  withNewType,
  withType,
  writeQuery,
} from '@/attributes'
import { createFakeAttributes } from './fakeAttributes'

const { attributes } = createFakeAttributes()
const named = (name: string) => attributes.find((attribute) => attribute.name === name)!

describe('the preview of a view', () => {
  const names = (list: AdminAttribute[]) => list.map((attribute) => attribute.name)

  it('holds the attributes of the kind in their order, and no inactive one unless asked for', () => {
    expect(names(visibleAttributes(attributes, 'stem', false))).toEqual([
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Lagerplatz',
      'Gesägt',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
    ])
    // on a beam also what the stem alone has and the beams inherit: Holzart, Fälldatum, Gesägt (not "Lagerplatz")
    expect(names(visibleAttributes(attributes, 'beam', false))).toEqual([
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Gesägt',
      'Sortierklasse',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
    ])
    expect(names(visibleAttributes(attributes, 'beam', true))).toContain('Entlastungsschnitt')
    expect(names(visibleAttributes(attributes, 'stem', true))).not.toContain('Entlastungsschnitt')
  })

  it('adds what the stem alone has and the beams inherit to the view "Balken", and nothing else', () => {
    const stemOnly = (inheritable: boolean) => ({
      ...named('Lagerplatz'),
      applies_to: ['stem'] as ItemKind[],
      is_inheritable: inheritable,
    })

    expect(isInheritedOnly(stemOnly(true), 'beam')).toBe(true)
    expect(isInheritedOnly(stemOnly(false), 'beam')).toBe(false)
    expect(isInheritedOnly(stemOnly(true), 'stem')).toBe(false)
    // valid for the beam itself: not "inherited only", an input
    expect(isInheritedOnly({ ...stemOnly(true), applies_to: ['stem', 'beam'] }, 'beam')).toBe(false)
    expect(visibleAttributes([stemOnly(true)], 'beam', false)).toHaveLength(1)
    expect(visibleAttributes([stemOnly(false)], 'beam', false)).toHaveLength(0)
    expect(visibleAttributes([{ ...stemOnly(true), active: false }], 'beam', false)).toHaveLength(0)
    expect(visibleAttributes([{ ...stemOnly(true), active: false }], 'beam', true)).toHaveLength(1)
    // an attribute of the beam alone is not on the stem, whatever it inherits
    const beamOnly = { ...named('Sortierklasse'), is_inheritable: true }
    expect(visibleAttributes([beamOnly], 'stem', false)).toHaveLength(0)
  })

  it('shows an attribute that another one hides: hidden_when plays no part', () => {
    const hiding = { ...named('Notiz'), hidden_when: ['sawn'] }
    expect(visibleAttributes([hiding], 'stem', false)).toEqual([hiding])
  })

  it('counts with the right word', () => {
    expect(countAttributes(1)).toBe('1 Merkmal')
    expect(countAttributes(10)).toBe('10 Merkmale')
  })
})

describe('the URL', () => {
  it('reads view, inactive and attribute with the stem as start state', () => {
    expect(readQuery({})).toEqual({ view: 'stem', inactive: false, attribute: null })
    expect(readQuery({ view: 'beam', inactive: '1', attribute: 'abc' })).toEqual({
      view: 'beam',
      inactive: true,
      attribute: 'abc',
    })
    expect(readQuery({ view: 'plank', inactive: '0' })).toEqual({
      view: 'stem',
      inactive: false,
      attribute: null,
    })
  })

  it('writes only what differs from the start state', () => {
    expect(writeQuery({ view: 'stem', inactive: false, attribute: null })).toEqual({})
    expect(writeQuery({ view: 'beam', inactive: true, attribute: 'abc' })).toEqual({
      view: 'beam',
      inactive: '1',
      attribute: 'abc',
    })
  })
})

describe('the form', () => {
  it('is unchanged until something differs, and again after undoing it', () => {
    const attribute = named('Lagerplatz')
    const draft = draftOf(attribute)
    expect(isChanged(attribute, draft)).toBe(false)

    expect(isChanged(attribute, { ...draft, name: 'Ort' })).toBe(true)
    expect(isChanged(attribute, { ...draft, appliesTo: ['beam', 'stem'] })).toBe(true)
    expect(isChanged(attribute, { ...draft, appliesTo: ['stem'] })).toBe(false)
    expect(
      isChanged(attribute, {
        ...draft,
        options: [...draft.options, { rowId: 1, label: '', active: true }],
      }),
    ).toBe(true)
  })

  it('drops the unit and the series with a type that has none', () => {
    const draft = { ...draftOf(named('Holzfeuchte')), unit: '%', isSeries: true }

    expect(withType(draft, 'number')).toMatchObject({ unit: '%', isSeries: true })
    expect(withType(draft, 'text')).toMatchObject({ unit: '', isSeries: true })
    expect(withType(draft, 'choice')).toMatchObject({ unit: '', isSeries: false })
    expect(withType(draft, 'boolean')).toMatchObject({ unit: '', isSeries: false })
  })

  it('sends options only for a choice, an existing one with its id, a new one without', () => {
    const draft = draftOf(named('Lagerplatz'))
    const body = bodyOf({
      ...draft,
      options: [...draft.options, { rowId: 99, label: 'Neu', active: true }],
    })

    expect(body.options.slice(0, -1).every((option) => option.id)).toBe(true)
    expect(body.options[body.options.length - 1]).toEqual({ label: 'Neu', active: true })
    expect(bodyOf({ ...draft, type: 'text' }).options).toEqual([])
    expect(bodyOf({ ...draft, type: 'text', unit: 'cm' }).unit).toBeNull()
    expect(bodyOf({ ...draftOf(named('Holzfeuchte')), unit: ' % ' }).unit).toBe('%')
  })

  it('reads the errors of a 422 by field, the first of a field counts', () => {
    expect(
      errorsOf({
        errors: [
          { field: 'name', message: 'a' },
          { field: 'name', message: 'b' },
          { field: 'options.1.label', message: 'c' },
        ],
      }),
    ).toEqual({ name: 'a', 'options.1.label': 'c' })
    expect(errorsOf(undefined)).toEqual({})
    expect(errorsOf({ errors: 'x' })).toEqual({})
  })
})

describe('a new attribute', () => {
  it('starts with the defaults of its type, valid for the view', () => {
    expect(newDraft('text', 'beam')).toMatchObject({
      name: '',
      appliesTo: ['beam'],
      isInheritable: false,
      isSeries: false,
      active: true,
      options: [],
    })
    expect(newDraft('choice', 'stem').options).toMatchObject([{ label: '', active: true }])
  })

  it('knows a month as a date', () => {
    expect(tileOf('month')).toBe('date')
    expect(tileOf('date')).toBe('date')
    expect(tileOf('boolean')).toBe('boolean')
  })

  it('keeps what fits when the type changes', () => {
    const draft = {
      ...newDraft('number', 'stem'),
      name: 'Maß',
      unit: 'cm',
      isSeries: true,
      appliesTo: ['stem', 'beam'] as ItemKind[],
    }

    expect(withNewType(draft, 'text')).toMatchObject({
      name: 'Maß',
      unit: '',
      isSeries: true,
      appliesTo: ['stem', 'beam'],
    })
    expect(withNewType(draft, 'boolean')).toMatchObject({ isSeries: false })
    const choice = withNewType(draft, 'choice')
    expect(choice.options).toHaveLength(1)
    expect(
      withNewType({ ...choice, options: [{ rowId: 1, label: 'A', active: true }] }, 'text').options,
    ).toEqual([])
  })

  it('is previewed as an attribute without a key, after the name is trimmed', () => {
    const attribute = previewOf({ ...newDraft('number', 'stem'), name: ' Maß ', unit: ' cm ' })

    expect(attribute).toMatchObject({
      name: 'Maß',
      unit: 'cm',
      key: null,
      is_system: false,
      applies_to: ['stem'],
    })
  })
})

describe('the order', () => {
  const at = (id: string, active = true) => ({ ...named('Notiz'), id, name: id, active })

  it('moves an item', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })

  it('gives the arranged attributes the places of the visible ones and leaves the others where they are', () => {
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((id) => at(id))

    // b and d are not in the view: c moves before a, b and d stay at places 2 and 4
    const result = applyVisibleOrder([a, b, c, d, e], [c, a, e])
    expect(result.map((attribute) => attribute.id)).toEqual(['c', 'b', 'a', 'd', 'e'])
    expect(applyVisibleOrder([a, b, c], [a, b, c]).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(applyVisibleOrder([a, b, c], [c, b, a]).map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })
})
