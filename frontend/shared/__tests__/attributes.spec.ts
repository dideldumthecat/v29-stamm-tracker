import { describe, expect, it } from 'vitest'

import {
  currentValue,
  formatDate,
  formatMonth,
  formatMonthLong,
  isInheritedValue,
  SAWN_KEY,
} from '../attributes'
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
