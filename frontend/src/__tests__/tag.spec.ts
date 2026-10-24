import { describe, it, expect } from 'vitest'
import { formatTag, isValidTag, isValidTagNumber, nextBeamTag } from '../utils/tag'

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

describe('isValidTag', () => {
  it('accepts plain and beam tags within the plaque range', () => {
    expect(isValidTag('85')).toBe(true)
    expect(isValidTag('85-A')).toBe(true)
    expect(isValidTag('85-AB')).toBe(false)
    expect(isValidTag('5000-A')).toBe(false)
    expect(isValidTag('85-a')).toBe(false)
    expect(isValidTag('85-')).toBe(false)
    expect(isValidTag('abc')).toBe(false)
  })
})

describe('nextBeamTag', () => {
  it('letters beams by the number ever created, A to Z, then none', () => {
    expect(nextBeamTag('123', 0)).toBe('123-A')
    expect(nextBeamTag('123', 2)).toBe('123-C')
    expect(nextBeamTag('7', 25)).toBe('7-Z')
    expect(nextBeamTag('7', 26)).toBeNull()
  })
})
