import { describe, expect, it } from 'vitest'
import type { KeyFigure } from '@v29/shared/contract'

import { formatFigure, formatPercent, formatVolume, numberParts } from '@/keyFigures'

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
    expect(formatFigure(figure(0.50234, 'fm'))).toBe('0,502 fm')
    expect(formatFigure(figure(0.30376, 'm³'))).toBe('0,304 m³')
    expect(formatFigure(figure(0.6047, '%'))).toBe('60 %')
    expect(formatFigure(figure(null, 'm³'))).toBeNull()
  })

  it('writes the diameter class as the two whole cm it holds', () => {
    expect(formatFigure(figure(32, 'cm'))).toBe('32–33 cm')
    expect(formatFigure(figure(null, 'cm'))).toBeNull()
  })
})

describe('numbers of a dashboard card line', () => {
  it('sets the numbers apart from the words between them', () => {
    expect(numberParts('50,0 % ≈ 1.025,76 Rm')).toEqual([
      { text: '50,0', number: true },
      { text: ' % ≈ ', number: false },
      { text: '1.025,76', number: true },
      { text: ' Rm', number: false },
    ])
    expect(numberParts('6,52 m³ · aus 62 Stämmen').filter((part) => part.number)).toEqual([
      { text: '6,52', number: true },
      { text: '62', number: true },
    ])
    expect(numberParts('3 gesägte Stämme')).toEqual([
      { text: '3', number: true },
      { text: ' gesägte Stämme', number: false },
    ])
  })
})
