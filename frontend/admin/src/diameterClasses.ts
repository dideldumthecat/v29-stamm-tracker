import type { Attribute, TimberItem } from '@v29/shared/contract'
import { MID_DIAMETER_KEYS } from '@v29/shared/attributes'

import { valueOfKey } from './itemValues'
import type { DiameterClass } from './api/contract'

export type DiameterColumn =
  'diameter' | 'yield' | 'stems' | 'not_sawable' | 'beams_per_stem_large' | 'beams_per_stem_small'
export interface DiameterSort {
  column: DiameterColumn
  dir: 'asc' | 'desc'
}

export const DEFAULT_DIAMETER_SORT: DiameterSort = { column: 'diameter', dir: 'desc' }

const valueOf = (row: DiameterClass, column: DiameterColumn) =>
  column === 'diameter' ? row.from_cm : row[column]

/** The classes in the given order; a value that is not calculable ("–") comes last either way, equal values by diameter descending. */
export function sortClasses(rows: DiameterClass[], { column, dir }: DiameterSort): DiameterClass[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = valueOf(a, column)
    const y = valueOf(b, column)
    if (x === y) return b.from_cm - a.from_cm
    if (x === null) return 1
    if (y === null) return -1
    return sign * (x - y)
  })
}

/** A click on the sorted column turns the direction; another column starts descending, like the default. */
export const sortOn = (sort: DiameterSort, column: DiameterColumn): DiameterSort =>
  sort.column === column
    ? { column, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
    : { column, dir: 'desc' }

/**
 * The diameter class of a stem, as `from_cm` (classes of two whole cm: 32 and 33 cm are 32, shown "32–33 cm"); null without a diameter.
 * The same rule as the server (`KeyFigures::diameterClass`, tested with the same cases): the mean of both diameters, rounded commercially
 * to whole cm (half up: 32.5 → 33); with only one recorded it counts for both; 0 or less is not measured.
 */
export function diameterClass(max: unknown, min: unknown): number | null {
  const known = (value: unknown) => (typeof value === 'number' && value > 0 ? value : null)
  const a = known(max) ?? known(min)
  const b = known(min) ?? known(max)
  if (a === null || b === null) return null
  // Rounded to 6 places first, so that float noise does not turn 32.5 into 32.4999…
  const whole = Math.round(Math.round(((a + b) / 2) * 1e6) / 1e6)
  return Math.floor(whole / 2) * 2
}

/** The diameter class of a stem from its values (the attributes are found by key); null without a diameter. */
export const diameterClassOf = (item: Pick<TimberItem, 'values'>, attributes: Attribute[]) =>
  diameterClass(
    valueOfKey(item, attributes, MID_DIAMETER_KEYS[0]),
    valueOfKey(item, attributes, MID_DIAMETER_KEYS[1]),
  )

/** A class as V29 reads it: from_cm 32 → "32–33 cm". */
export const formatDiameterClass = (fromCm: number) => `${fromCm}–${fromCm + 1} cm`
