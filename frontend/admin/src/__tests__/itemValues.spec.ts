import { describe, expect, it } from 'vitest'

import type { Attribute } from '@v29/shared/contract'

import { currentValue, formatMonthLong, hasValueOfKey, isMarked } from '@/itemValues'

describe('formatMonthLong', () => {
  it('writes the month in words with the year', () => {
    expect(formatMonthLong('2026-10')).toBe('Oktober 2026')
    expect(formatMonthLong('2027-03')).toBe('März 2027')
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
    expect(isMarked(item, attributes, 'sawn')).toBe(true)
    expect(isMarked(item, attributes, 'unsawable')).toBe(false)
    expect(hasValueOfKey(item, attributes, 'mid_diameter_max')).toBe(true)
    expect(hasValueOfKey(item, attributes, 'sawn_cross_section')).toBe(false)
  })

  it('has nothing for an item without values', () => {
    expect(isMarked({ values: { a3: records(false) } }, attributes, 'sawn')).toBe(false)
  })
})
