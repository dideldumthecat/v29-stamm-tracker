import { describe, expect, it } from 'vitest'
import type { KeyFigure } from '@v29/shared/contract'

import { formatFigure, formatPercent, formatVolume } from '@/keyFigures'

const figure = (value: number | null, unit: KeyFigure['unit']): KeyFigure => ({
  key: unit === '%' ? 'yield' : 'round_wood',
  label: 'x',
  value,
  unit,
  source: '',
  formula: '',
  inserted: null,
  note: null,
})

describe('key figure formatting', () => {
  it('writes cubic metres with three decimals and a comma', () => {
    expect(formatVolume(0.50234)).toBe('0,502')
    expect(formatVolume(0.3)).toBe('0,300')
    expect(formatVolume(12)).toBe('12,000')
    expect(formatVolume(1234.5678)).toBe('1.234,568')
  })

  it('writes the share as whole percent', () => {
    expect(formatPercent(0.6047)).toBe('60')
    expect(formatPercent(0.605)).toBe('61')
    expect(formatPercent(1)).toBe('100')
  })

  it('joins value and unit with a no-break space, and has nothing for a figure that cannot be calculated', () => {
    expect(formatFigure(figure(0.50234, 'm³'))).toBe('0,502 m³')
    expect(formatFigure(figure(0.6047, '%'))).toBe('60 %')
    expect(formatFigure(figure(null, 'm³'))).toBeNull()
  })
})
