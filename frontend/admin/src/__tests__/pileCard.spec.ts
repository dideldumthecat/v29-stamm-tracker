import { describe, expect, it } from 'vitest'

import {
  axisSteps,
  beamTotals,
  isoWeek,
  progressText,
  stemsText,
  weekLabel,
  weekRange,
} from '@/pileCard'

describe('calendar weeks', () => {
  it('numbers the ISO weeks, week 53 of 2026 and week 1 of 2027 included', () => {
    expect(isoWeek('2026-11-02')).toBe(45)
    expect(isoWeek('2026-12-21')).toBe(52)
    expect(isoWeek('2026-12-28')).toBe(53)
    expect(isoWeek('2027-01-04')).toBe(1)
    expect(isoWeek('2026-01-05')).toBe(2)
    expect(isoWeek('2024-12-30')).toBe(1)
  })

  it('writes the period Monday to Sunday, across a month and across a year', () => {
    expect(weekRange('2026-11-02')).toBe('2.–8.11.')
    expect(weekRange('2026-10-26')).toBe('26.10.–1.11.')
    expect(weekRange('2026-12-28')).toBe('28.12.–3.1.')
    expect(weekRange('2026-03-30')).toBe('30.3.–5.4.')
  })

  it('labels the current week with "bis heute" instead of the period', () => {
    expect(weekLabel('2026-11-09', false)).toEqual({ title: 'KW 46', period: '9.–15.11.' })
    expect(weekLabel('2026-11-16', true)).toEqual({ title: 'KW 47', period: 'bis heute' })
  })
})

describe('axis', () => {
  it.each([
    [24, 10, [0, 10, 20, 30]],
    [30, 10, [0, 10, 20, 30]],
    [31, 10, [0, 10, 20, 30, 40]],
    [41, 20, [0, 20, 40, 60]],
    [12, 5, [0, 5, 10, 15]],
    [8, 2, [0, 2, 4, 6, 8]],
    [3, 1, [0, 1, 2, 3]],
    [1, 1, [0, 1]],
    [0, 1, [0, 1]],
    [95, 50, [0, 50, 100]],
  ])('takes round steps for a highest column of %d', (max, step, ticks) => {
    const axis = axisSteps(max)
    expect(axis.step).toBe(step)
    expect(axis.ticks).toEqual(ticks)
    expect(axis.top).toBe(ticks[ticks.length - 1])
    expect(axis.top).toBeGreaterThanOrEqual(max)
  })
})

describe('texts of the card', () => {
  it('counts stems', () => {
    expect(stemsText(1)).toBe('1 Stamm')
    expect(stemsText(130)).toBe('130 Stämme')
  })

  it('writes the progress with one decimal, and 0 % for a pile with nothing processed', () => {
    expect(progressText({ stems: 130, progress: { sawn: 60, not_sawable: 3, open: 67 } })).toBe(
      '48,5 %',
    )
    expect(progressText({ stems: 3, progress: { sawn: 0, not_sawable: 0, open: 3 } })).toBe('0 %')
    expect(progressText({ stems: 2, progress: { sawn: 2, not_sawable: 0, open: 0 } })).toBe(
      '100,0 %',
    )
  })
})

describe('figures of the card', () => {
  it('adds up the beams of all weeks by size, 0 for a pile without a sawn beam', () => {
    expect(
      beamTotals({
        weeks: [
          { week_start: '2026-11-02', large: 3, small: 2 },
          { week_start: '2026-11-09', large: 0, small: 0 },
          { week_start: '2026-11-16', large: 4, small: 1 },
        ],
      }),
    ).toEqual({ large: 7, small: 3 })
    expect(beamTotals({ weeks: [] })).toEqual({ large: 0, small: 0 })
  })
})
