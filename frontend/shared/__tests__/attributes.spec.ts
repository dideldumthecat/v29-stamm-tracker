import { describe, expect, it } from 'vitest'

import { formatDate, formatMonth, isInheritedValue } from '../attributes'

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
