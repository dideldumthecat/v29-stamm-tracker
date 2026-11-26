import { describe, expect, it } from 'vitest'

import { arrowRightOf } from '@/useAddCard'

describe('arrowRightOf', () => {
  it('puts the middle of the arrow over the middle of the button at the right edge of the card', () => {
    // Card 32…1248, button 1051…1248 (197 px wide): middle at 1149.5, 98.5 px from the edge, less half the arrow and the border
    expect(arrowRightOf({ right: 1248 }, { left: 1051, width: 197 })).toBe(91)
  })

  it('follows a narrower button', () => {
    expect(arrowRightOf({ right: 1248 }, { left: 1100, width: 148 })).toBe(66)
  })
})
