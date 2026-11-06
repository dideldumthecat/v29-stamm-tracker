import { describe, expect, it } from 'vitest'

import { formatTag } from '../tag'

describe('formatTag', () => {
  it('pads to the plaque format', () => {
    expect(formatTag(42)).toBe('00042')
    expect(formatTag(1999)).toBe('01999')
  })
})
