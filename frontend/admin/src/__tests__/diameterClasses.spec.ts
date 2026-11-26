import { describe, expect, it } from 'vitest'

import type { Attribute } from '@v29/shared/contract'

import { diameterClass, diameterClassOf, formatDiameterClass } from '@/diameterClasses'

// The cases of KeyFiguresTest (backend): the list of stems works the class out itself and must come to the same result as the server.
describe('diameterClass', () => {
  it('puts a stem in the class of two whole cm that holds the rounded mean', () => {
    expect(diameterClass(40, 39)).toBe(40)
    expect(diameterClass(33.4, 33.4)).toBe(32)
    expect(diameterClass(34, 34)).toBe(34)
  })

  it('rounds the mean half up, also against float noise', () => {
    // (31 + 32) ÷ 2 = 31,5 → 32; (35 + 32) ÷ 2 = 33,5 → 34; (32,4 + 32,4) ÷ 2 stays 32
    expect(diameterClass(31, 32)).toBe(32)
    expect(diameterClass(35, 32)).toBe(34)
    expect(diameterClass(32.4, 32.4)).toBe(32)
    // (34,7 + 33,3) ÷ 2 = 34 exactly, not 33,999…
    expect(diameterClass(34.7, 33.3)).toBe(34)
    // the mean 32,5 of 32,4 and 32,6 is in the class 32–33 (33 cm)
    expect(diameterClass(32.6, 32.4)).toBe(32)
  })

  it('lets one diameter count alone, and 0 or nothing is not measured', () => {
    expect(diameterClass(undefined, 31)).toBe(30)
    expect(diameterClass(31.5, undefined)).toBe(32)
    expect(diameterClass(0, 31)).toBe(30)
    expect(diameterClass(31.5, 0)).toBe(32)
    expect(diameterClass(undefined, undefined)).toBeNull()
    expect(diameterClass(0, 0)).toBeNull()
    expect(diameterClass('40', 'x')).toBeNull()
  })
})

describe('formatDiameterClass', () => {
  it('names the two whole cm of the class', () => {
    expect(formatDiameterClass(32)).toBe('32–33 cm')
    expect(formatDiameterClass(40)).toBe('40–41 cm')
  })
})

describe('diameterClassOf', () => {
  const attributes = [
    { id: 'a1', key: 'mid_diameter_max' },
    { id: 'a2', key: 'mid_diameter_min' },
    { id: 'a4', key: null },
  ] as Attribute[]
  const records = (value: number) => [{ value, recorded_at: '', user_id: 'u', event_id: 'e' }]

  it('reads both diameters by their keys, never by name', () => {
    const item = { values: { a1: records(40), a2: records(39), a4: records(99) } }
    expect(diameterClassOf(item, attributes)).toBe(40)
  })

  it('has nothing for an item without values', () => {
    expect(diameterClassOf({ values: {} }, attributes)).toBeNull()
  })
})
