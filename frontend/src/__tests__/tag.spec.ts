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
  it('takes the first free letter, A to Z, then none', () => {
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    expect(nextBeamTag('123', [])).toBe('123-A')
    expect(nextBeamTag('123', ['123-A', '123-B'])).toBe('123-C')
    expect(nextBeamTag('123', ['123-A', '123-C'])).toBe('123-B')
    expect(
      nextBeamTag(
        '7',
        letters.slice(0, 25).map((letter) => `7-${letter}`),
      ),
    ).toBe('7-Z')
    expect(
      nextBeamTag(
        '7',
        letters.map((letter) => `7-${letter}`),
      ),
    ).toBeNull()
  })

  // Rule: first unused letter after skipping one unused letter (from A on) per beam with its own plaque.
  it('keeps the letter of a beam that got its own plaque taken', () => {
    expect(nextBeamTag('1', ['1-A', '345'])).toBe('1-C')
    expect(nextBeamTag('1', ['345', '1-B'])).toBe('1-C')
    expect(nextBeamTag('1', ['345'])).toBe('1-B')
    expect(nextBeamTag('1', ['1-A', '345', '1-C', '346'])).toBe('1-E')
  })
})
