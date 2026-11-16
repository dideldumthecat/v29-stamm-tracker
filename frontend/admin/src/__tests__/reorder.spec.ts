import { describe, expect, it } from 'vitest'

import { dropIndex } from '@/reorder'

// Five items of 100 px: their middles lie at 50, 150, 250, 350 and 450
const middles = [50, 150, 250, 350, 450]

describe('the place of a dragged item', () => {
  it('stays where it was while the pointer has not passed a neighbour', () => {
    expect(dropIndex(middles, 2, 250)).toBe(2)
    expect(dropIndex(middles, 2, 200)).toBe(2)
    expect(dropIndex(middles, 2, 300)).toBe(2)
  })

  it('moves down with the middle of the item passing the middle of the next', () => {
    expect(dropIndex(middles, 0, 160)).toBe(1)
    expect(dropIndex(middles, 0, 270)).toBe(2)
    expect(dropIndex(middles, 0, 5000)).toBe(4)
  })

  it('moves up the same way, and stops at the first place', () => {
    expect(dropIndex(middles, 3, 240)).toBe(2)
    expect(dropIndex(middles, 3, 100)).toBe(1)
    expect(dropIndex(middles, 3, -300)).toBe(0)
  })
})
