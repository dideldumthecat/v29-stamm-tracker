import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attribute } from '@v29/shared/contract'

import {
  applyFilters,
  buildColumns,
  buildRows,
  cellOf,
  filtersFor,
  headingWords,
  MAX_UNBROKEN_WORD_LENGTH,
  readQuery,
  sortBy,
  sortRows,
  stemsText,
  tagFilter,
  withCells,
  writeQuery,
  type Column,
  type RawRow,
  type Row,
} from '@/stemlist'
import { snapshotFixture } from './fakeSnapshot'

// "Geändert" shows the year only outside the current one, so the clock is pinned.
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-09T12:00:00Z') }))
afterEach(() => vi.useRealTimers())

const { attributes } = snapshotFixture
const columns = buildColumns(attributes)
const rows = buildRows(snapshotFixture)
const column = (label: string) => columns.find((candidate) => candidate.label === label)!
const row = (tag: string | null) => rows.find((candidate) => candidate.item.tag_number === tag)!
const tags = (list: Row[]) => list.map((candidate) => candidate.item.tag_number)

describe('buildColumns', () => {
  it('has the stem, one column per active attribute of stems in V29 order, the beams and the last change', () => {
    expect(columns.map((candidate) => candidate.label)).toEqual([
      'Stamm',
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Lagerplatz',
      'Gesägt',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
      'Balken',
      'Geändert',
    ])
  })

  it('leaves out attributes for beams only and inactive ones, takes a new stem attribute without a code change', () => {
    const extra: Attribute = {
      ...attributes[0],
      id: 'new',
      name: 'Etwas Neues',
      type: 'text',
      is_series: false,
      applies_to: ['stem'],
      sort_order: 5,
      options: [],
    }
    const labels = buildColumns([...attributes, extra]).map((candidate) => candidate.label)
    expect(labels).not.toContain('Sortierklasse')
    expect(labels).not.toContain('Entlastungsschnitt')
    expect(labels[1]).toBe('Etwas Neues')
  })

  it('writes numbers, photos and beams to the right and lets only texts and choices wrap', () => {
    const right = columns.filter((candidate) => candidate.align === 'right')
    expect(right.map((candidate) => candidate.label)).toEqual(['Holzfeuchte', 'Fotos', 'Balken'])
    expect(columns.filter((candidate) => candidate.wraps).map((c) => c.label)).toEqual([
      'Holzart',
      'Lagerplatz',
      'Notiz',
    ])
  })
})

describe('buildRows', () => {
  it('has one row per stem, beams only counted', () => {
    expect(tags(rows)).toEqual(['104', '7', '1500', null])
    expect(rows.map((candidate) => candidate.beams)).toEqual([3, 0, 0, 0])
  })

  it('takes the latest own recording as the last change, the creation without any', () => {
    expect(row('104').changed).toBe('2026-10-31T10:50:00.000Z')
    expect(row('7').changed).toBe('2026-10-20T08:00:00.000Z')
  })
})

describe('cellOf', () => {
  const text = (tag: string | null, label: string) => cellOf(row(tag), column(label)).text

  it('writes values like the rest of the administration, not recorded as null', () => {
    expect(text('104', 'Holzart')).toBe('Stieleiche')
    expect(text('104', 'Fälldatum')).toBe('10/2026')
    expect(text('104', 'Gesägt')).toBe('ja')
    expect(text('1500', 'Gesägt')).toBe('nein')
    expect(text('1500', 'Holzfeuchte')).toBe('30 %')
    expect(text('7', 'Holzart')).toBeNull()
    expect(text('7', 'Fotos')).toBeNull()
  })

  it('shows the latest of a series, a note with the number of older ones behind it', () => {
    expect(text('104', 'Holzfeuchte')).toBe('41 %')
    expect(text('104', 'Notiz')).toBe('Zweite Zeile\nmit Umbruch')
    expect(cellOf(row('104'), column('Notiz')).more).toBe(1)
    expect(text(null, 'Notiz')).toBe('Plakette fehlt')
    expect(cellOf(row(null), column('Notiz')).more).toBe(0)
  })

  it('counts photos and beams, and writes the last change without the year in this year', () => {
    expect(text('104', 'Fotos')).toBe('2')
    expect(text('104', 'Balken')).toBe('3')
    expect(text('7', 'Balken')).toBe('0')
    expect(text('104', 'Geändert')).toBe('31.10.')
    expect(text('1500', 'Geändert')).toBe('30.12.25')
  })
})

describe('"Geändert" cell', () => {
  const cell = (tag: string | null) => cellOf(row(tag), column('Geändert'))

  it('has the date and the person of the latest recording', () => {
    expect(cell('104')).toMatchObject({ text: '31.10.', by: 'Alexander Barina' })
  })

  it('has the date and the person of the creation without a recording', () => {
    expect(cell('7')).toMatchObject({ text: '20.10.', by: 'Alexander Summa' })
  })

  it('has only the date for a person the snapshot does not know, and still sorts by date', () => {
    const unknown = buildRows({ ...snapshotFixture, users: [] })
    expect(unknown.map((candidate) => cellOf(candidate, column('Geändert')).by)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(cellOf(unknown[0], column('Geändert')).text).toBe('31.10.')
    expect(tags(sortRows(unknown, column('Geändert'), 'asc'))).toEqual(['1500', '7', null, '104'])
  })
})

describe('sortRows', () => {
  const order = (label: string, dir: 'asc' | 'desc' = 'asc') =>
    tags(sortRows(rows, column(label), dir))
  // rows: 104 (all values), 7 (nothing), 1500 (some values), and a stem without tag (only a note)

  it('sorts by the stem number, a stem without tag last in both directions', () => {
    expect(order('Stamm')).toEqual(['7', '104', '1500', null])
    expect(order('Stamm', 'desc')).toEqual(['1500', '104', '7', null])
  })

  it('sorts numbers numerically, choices by the order of the options, dates by time', () => {
    expect(order('Holzfeuchte')).toEqual(['1500', '104', '7', null])
    expect(order('Holzfeuchte', 'desc')).toEqual(['104', '1500', '7', null])
    // Traubeneiche (10) before Stieleiche (20)
    expect(order('Holzart')).toEqual(['1500', '104', '7', null])
    expect(order('Holzart', 'desc')).toEqual(['104', '1500', '7', null])
    // December 2025 before October 2026
    expect(order('Fälldatum')).toEqual(['1500', '104', '7', null])
    expect(order('Fälldatum', 'desc')).toEqual(['104', '1500', '7', null])
    // the stem without tag was last changed on the 21st, between 7 (created on the 20th) and 104
    expect(order('Geändert')).toEqual(['1500', '7', null, '104'])
    expect(order('Geändert', 'desc')).toEqual(['104', null, '7', '1500'])
  })

  it('sorts yes, no, not recorded ascending and no, yes, not recorded descending', () => {
    expect(order('Gesägt')).toEqual(['104', '1500', '7', null])
    expect(order('Gesägt', 'desc')).toEqual(['1500', '104', '7', null])
  })

  it('sorts photos and beams by number: no photo is not recorded, no beams is the number 0', () => {
    expect(order('Fotos')).toEqual(['104', '7', '1500', null])
    expect(order('Fotos', 'desc')).toEqual(['104', '7', '1500', null])
    expect(order('Balken')).toEqual(['7', '1500', null, '104'])
    expect(order('Balken', 'desc')).toEqual(['104', '7', '1500', null])
  })

  it('sorts a text by whether there is one, not by what it says, and puts "none" first when descending; the stem number decides inside the groups', () => {
    expect(order('Notiz')).toEqual(['104', null, '7', '1500'])
    expect(order('Notiz', 'desc')).toEqual(['7', '1500', '104', null])

    const notiz = column('Notiz')
    const make = (text: string, id: string): RawRow => ({
      item: {
        ...rows[1].item,
        id,
        tag_number: id,
        values: { [notiz.id]: [{ ...row('104').item.values[notiz.id][0], value: text }] },
      },
      beams: 0,
      changed: '2026-10-31T10:00:00.000Z',
      changedBy: undefined,
    })
    const list = withCells([make('Zebra', '1'), make('Äpfel', '2'), make('apfel', '3')], columns)
    expect(tags(sortRows(list, notiz, 'asc'))).toEqual(['1', '2', '3'])
    expect(tags(sortRows(list, notiz, 'desc'))).toEqual(['1', '2', '3'])
  })

  it('keeps the stem number order in both directions where nothing is recorded or all values are equal', () => {
    const lieferdatum = column('Lieferdatum')
    expect(tags(sortRows(rows, lieferdatum, 'asc'))).toEqual(['7', '104', '1500', null])
    expect(tags(sortRows(rows, lieferdatum, 'desc'))).toEqual(['7', '104', '1500', null])
    const equal = withCells(
      rows.map((candidate) => ({ ...candidate, beams: 2 })),
      columns,
    )
    expect(tags(sortRows(equal, column('Balken'), 'desc'))).toEqual(['7', '104', '1500', null])
  })
})

describe('filters', () => {
  const filtered = (text: string) => tags(applyFilters(rows, filtersFor({ ...query, tags: text })!))
  const query = { tags: '', sort: 'tag', dir: 'asc' as const }

  it('matches a number, a range and several parts; stems without a tag never', () => {
    expect(filtered('104')).toEqual(['104'])
    expect(filtered('100-120')).toEqual(['104'])
    expect(filtered('7, 1500')).toEqual(['7', '1500'])
    expect(filtered('all')).toEqual(['104', '7', '1500'])
    expect(filtered('8-99')).toEqual([])
  })

  it('has no filter without text and refuses text it cannot read', () => {
    expect(filtersFor(query)).toEqual([])
    expect(tagFilter('abc')).toBeNull()
    expect(filtersFor({ ...query, tags: '100-' })).toBeNull()
    expect(filtersFor({ ...query, tags: '2000' })).toBeNull()
  })

  it('keeps only rows that pass every filter', () => {
    const none = () => false
    expect(applyFilters(rows, [tagFilter('104')!, none])).toEqual([])
    expect(applyFilters(rows, [tagFilter('7-104')!, tagFilter('100-200')!])).toHaveLength(1)
  })
})

describe('stemsText', () => {
  it('counts the stems, with a filter "von" all, with the singular', () => {
    expect(stemsText(130, 130, false)).toBe('130 Stämme')
    expect(stemsText(1, 1, false)).toBe('1 Stamm')
    expect(stemsText(34, 130, true)).toBe('34 von 130 Stämmen')
    expect(stemsText(1, 1, true)).toBe('1 von 1 Stamm')
    expect(stemsText(1, 1300, true)).toBe('1 von 1.300 Stämmen')
  })
})

describe('URL', () => {
  const columnIds = columns as Column[]
  const holzart = column('Holzart').id

  it('reads tags, sort and direction, and ignores a sort that is no column', () => {
    expect(readQuery({}, columnIds)).toEqual({ tags: '', sort: 'tag', dir: 'asc' })
    expect(readQuery({ tags: ' 100-120 ', sort: holzart, dir: 'desc' }, columnIds)).toEqual({
      tags: '100-120',
      sort: holzart,
      dir: 'desc',
    })
    expect(readQuery({ sort: 'x', dir: 'up', tags: null }, columnIds)).toEqual({
      tags: '',
      sort: 'tag',
      dir: 'asc',
    })
    expect(readQuery({ sort: ['beams', 'changed'] }, columnIds).sort).toBe('beams')
  })

  it('writes only what is not the default, and reads back what it wrote', () => {
    expect(writeQuery({ tags: '', sort: 'tag', dir: 'asc' })).toEqual({})
    expect(writeQuery({ tags: '104', sort: 'beams', dir: 'desc' })).toEqual({
      tags: '104',
      sort: 'beams',
      dir: 'desc',
    })
    for (const state of [
      { tags: '1-10,15', sort: holzart, dir: 'asc' as const },
      { tags: '', sort: 'tag', dir: 'desc' as const },
    ]) {
      expect(readQuery(writeQuery(state), columnIds)).toEqual(state)
    }
  })

  it('flips the direction on the same column, starts ascending on another', () => {
    const state = { tags: '104', sort: 'tag', dir: 'asc' as const }
    expect(sortBy(state, 'tag')).toEqual({ ...state, dir: 'desc' })
    expect(sortBy({ ...state, dir: 'desc' }, 'tag').dir).toBe('asc')
    expect(sortBy({ ...state, dir: 'desc' }, 'beams')).toEqual({
      tags: '104',
      sort: 'beams',
      dir: 'asc',
    })
  })
})

describe('headingWords', () => {
  it('does not hyphenate a short word, only a long one', () => {
    expect(headingWords('Balken')).toEqual([{ text: 'Balken', hyphenate: false }])
    expect(headingWords('Stammmittendurchmesser')).toEqual([
      { text: 'Stammmittendurchmesser', hyphenate: true },
    ])
  })

  it('judges every word on its own, a break between words stays possible', () => {
    expect(headingWords('Stammmittendurchmesser  groß')).toEqual([
      { text: 'Stammmittendurchmesser', hyphenate: true },
      { text: 'groß', hyphenate: false },
    ])
    expect(headingWords('Nicht sägbar').map((word) => word.text)).toEqual(['Nicht', 'sägbar'])
  })

  it('draws the line after 14 characters: 14 stay whole, 15 may be hyphenated', () => {
    expect(MAX_UNBROKEN_WORD_LENGTH).toBe(14)
    expect(headingWords('a'.repeat(14))[0].hyphenate).toBe(false)
    expect(headingWords('a'.repeat(15))[0].hyphenate).toBe(true)
  })
})
