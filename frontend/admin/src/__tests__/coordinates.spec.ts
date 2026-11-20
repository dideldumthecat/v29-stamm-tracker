import { describe, expect, it } from 'vitest'

import { parseCoordinate } from '@/coordinates'

describe('parseCoordinate', () => {
  it.each([
    ['51.4132', 51.4132],
    ['51,4132', 51.4132],
    ['  13.06 ', 13.06],
    ['-51,4°', -51.4],
    ['51', 51],
    ['0', 0],
  ])('reads decimal degrees %j', (text, expected) => {
    expect(parseCoordinate(text)).toBe(expected)
  })

  it.each([
    [`51°24'47"`, 51.413056],
    [`13°03'38"`, 13.060556],
    [`51° 24′ 47″`, 51.413056],
    [`51 ° 24 ' 47 "`, 51.413056],
    [`51°24'47''`, 51.413056],
    [`51°24’47”`, 51.413056],
    [`51°24'47,5"`, 51.413194],
    [`51°24'47.5"`, 51.413194],
    [`51°24.5'`, 51.408333],
    [`51°24'`, 51.4],
    [`51°`, 51],
    [`-51°24'47"`, -51.413056],
  ])('reads degrees, minutes and seconds %j', (text, expected) => {
    expect(parseCoordinate(text)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'abc',
    '51,4,3',
    "51.4°24'",
    `51°24.5'47"`,
    `51°60'`,
    `51°24'60"`,
    `51°24'47`,
    `51"`,
    `N 51°24'47"`,
    '51°24 47',
    '--51',
  ])('does not read %j', (text) => {
    expect(parseCoordinate(text)).toBeNull()
  })
})
