import type { DiameterClass } from '@v29/shared/contract'

export type DiameterColumn = 'diameter' | 'stems' | 'yield' | 'beams_per_stem'
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
