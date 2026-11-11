import { describe, it, expect } from 'vitest'
import { scrollDistance } from '@/composables/useKeepFieldPosition'

describe('scrollDistance', () => {
  it('scrolls down by the height of what appeared above the field', () => {
    expect(scrollDistance(300, 380)).toBe(80)
  })

  it('scrolls up by the height of what disappeared above the field', () => {
    expect(scrollDistance(300, 220)).toBe(-80)
  })

  it('stays put when the field did not move', () => {
    expect(scrollDistance(300, 300)).toBe(0)
  })
})
