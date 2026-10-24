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
    expect(isValidTag('85-AB')).toBe(true)
    expect(isValidTag('5000-A')).toBe(false)
    expect(isValidTag('85-a')).toBe(false)
    expect(isValidTag('85-')).toBe(false)
    expect(isValidTag('abc')).toBe(false)
  })
})

describe('nextBeamTag', () => {
  it('letters beams in order, starting with A', () => {
    expect(nextBeamTag('123', [])).toBe('123-A')
    expect(nextBeamTag('123', ['123-A', '123-B'])).toBe('123-C')
  })

  it('reuses the first free letter and ignores relabelled siblings', () => {
    expect(nextBeamTag('123', ['123-A', '123-C'])).toBe('123-B')
    expect(nextBeamTag('123', ['1500', null])).toBe('123-A')
  })

  it('continues after Z with two letters', () => {
    const used = Array.from({ length: 26 }, (_, index) => `7-${String.fromCharCode(65 + index)}`)
    expect(nextBeamTag('7', used)).toBe('7-AA')
    expect(nextBeamTag('7', [...used, '7-AA'])).toBe('7-AB')
  })
})
