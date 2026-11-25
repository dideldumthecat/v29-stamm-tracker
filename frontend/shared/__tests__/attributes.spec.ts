import { describe, expect, it } from 'vitest'

import {
  currentValue,
  diameterClass,
  diameterClassOf,
  formatDate,
  formatDiameterClass,
  hasValueOfKey,
  isMarked,
  formatMonth,
  formatMonthLong,
  isInheritedValue,
  SAWN_KEY,
} from '../attributes'
import type { Attribute } from '../contract'
import snapshot from '../fixtures/snapshot.json' with { type: 'json' }

describe('formatDate', () => {
  it('writes the contract date the way V29 does', () => {
    expect(formatDate('2026-09-08')).toBe('08.09.2026')
  })
})

describe('formatMonth', () => {
  it('writes the contract month the way V29 does', () => {
    expect(formatMonth('2026-10')).toBe('10/2026')
  })
})

describe('formatMonthLong', () => {
  it('writes the month in words with the year', () => {
    expect(formatMonthLong('2026-10')).toBe('Oktober 2026')
    expect(formatMonthLong('2027-03')).toBe('März 2027')
  })
})

describe('isInheritedValue', () => {
  const record = (event_id: string) => [
    { value: 'x', recorded_at: '2026-10-02T07:12:00Z', user_id: 'u', event_id },
  ]
  it('is true only when the beam shows the recording of its parent', () => {
    const parent = { values: { a: record('e1'), b: record('e2') } }
    const beam = { values: { a: record('e1'), b: record('e3') } }
    expect(isInheritedValue(beam, parent, 'a')).toBe(true)
    expect(isInheritedValue(beam, parent, 'b')).toBe(false)
    expect(isInheritedValue(beam, parent, 'c')).toBe(false)
    expect(isInheritedValue(beam, undefined, 'a')).toBe(false)
  })
})

describe('currentValue', () => {
  const attribute = (type: Attribute['type']) => ({ type }) as Attribute
  const records = (...values: boolean[]) =>
    values.map((value) => ({ value, recorded_at: '', user_id: 'u', event_id: 'e' }))
  it('is the latest recorded value', () => {
    expect(currentValue(attribute('boolean'), records(false, true), true)).toBe(true)
    expect(currentValue(attribute('boolean'), records(true, false), false)).toBe(false)
  })
  it('counts a yes/no attribute without a value as "nein" if it applies, nothing otherwise', () => {
    expect(currentValue(attribute('boolean'), undefined, true)).toBe(false)
    expect(currentValue(attribute('boolean'), [], true)).toBe(false)
    expect(currentValue(attribute('boolean'), undefined, false)).toBeUndefined()
  })
  it('leaves every other type not recorded', () => {
    expect(currentValue(attribute('number'), undefined, true)).toBeUndefined()
    expect(currentValue(attribute('choice'), [], true)).toBeUndefined()
  })
})

describe('SAWN_KEY', () => {
  it('is the key of "Gesägt" in the shared snapshot', () => {
    expect(snapshot.attributes.find((attribute) => attribute.key === SAWN_KEY)?.name).toBe('Gesägt')
  })
})

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

describe('values by key', () => {
  const attributes = [
    { id: 'a1', key: 'mid_diameter_max' },
    { id: 'a2', key: 'mid_diameter_min' },
    { id: 'a3', key: 'sawn' },
    { id: 'a4', key: null },
  ] as Attribute[]
  const records = (value: boolean | number) => [
    { value, recorded_at: '', user_id: 'u', event_id: 'e' },
  ]

  it('reads the latest value of the attribute with the key, never by name', () => {
    const item = {
      values: { a1: records(40), a2: records(39), a3: records(true), a4: records(99) },
    }
    expect(diameterClassOf(item, attributes)).toBe(40)
    expect(isMarked(item, attributes, 'sawn')).toBe(true)
    expect(isMarked(item, attributes, 'unsawable')).toBe(false)
    expect(hasValueOfKey(item, attributes, 'mid_diameter_max')).toBe(true)
    expect(hasValueOfKey(item, attributes, 'sawn_cross_section')).toBe(false)
  })

  it('has nothing for an item without values', () => {
    expect(diameterClassOf({ values: {} }, attributes)).toBeNull()
    expect(isMarked({ values: { a3: records(false) } }, attributes, 'sawn')).toBe(false)
  })
})
