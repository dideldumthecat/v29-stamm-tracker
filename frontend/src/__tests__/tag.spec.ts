import { describe, it, expect } from 'vitest'
import { formatTag, isValidTagNumber } from '../utils/tag'

describe('formatTag', () => {
  it('pads to the plaque format', () => {
    expect(formatTag(42)).toBe('00042')
    expect(formatTag(1999)).toBe('01999')
  })
})

describe('isValidTagNumber', () => {
  it('accepts whole numbers in the plaque range only', () => {
    expect(isValidTagNumber(1)).toBe(true)
    expect(isValidTagNumber(1999)).toBe(true)
    expect(isValidTagNumber(0)).toBe(false)
    expect(isValidTagNumber(2000)).toBe(false)
    expect(isValidTagNumber(1.5)).toBe(false)
    expect(isValidTagNumber(NaN)).toBe(false)
  })
})
