import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attribute, DashboardDiameterSection, DashboardResponse } from '@v29/shared/contract'
import dashboardFixture from '@v29/shared/fixtures/dashboard-response.json' with { type: 'json' }

import { applyFilters, tagFilter } from '@/listFilters'
import {
  buildColumns,
  buildRows,
  cellOf,
  filtersFor,
  headingWords,
  MAX_UNBROKEN_WORD_LENGTH,
  processedStemsLink,
  readQuery,
  sortBy,
  sortRows,
  itemsText,
  withCells,
  writeQuery,
  type Column,
  type RawRow,
  type Row,
} from '@/stemlist'
import { processingAttributes, processingSnapshot, stemWithBeams, type StemSpec } from './fakeStems'
import { snapshotFixture } from './fakeSnapshot'

// "Geändert" shows the year only outside the current one, so the clock is pinned.
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-09T12:00:00Z') }))
afterEach(() => vi.useRealTimers())

const { attributes } = snapshotFixture
const columns = buildColumns(attributes, 'stem')
const rows = buildRows(snapshotFixture, 'stem')
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
      'Mittendurchmesser',
      'Bearbeitet',
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
    const labels = buildColumns([...attributes, extra], 'stem').map((candidate) => candidate.label)
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
    // a yes/no attribute without a value is "nein", other types stay "–"
    expect(text('7', 'Gesägt')).toBe('nein')
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
    expect(cell('104')).toMatchObject({ text: '31.10.', by: 'Aaron Bauer' })
  })

  it('has the date and the person of the creation without a recording', () => {
    expect(cell('7')).toMatchObject({ text: '20.10.', by: 'Alex Beispiel' })
  })

  it('has only the date for a person the snapshot does not know, and still sorts by date', () => {
    const unknown = buildRows({ ...snapshotFixture, users: [] }, 'stem')
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

  it('sorts yes before no ascending and no before yes descending; no value counts as no, ties by tag', () => {
    // "7" and the stem without a tag have no value: "nein"
    expect(order('Gesägt')).toEqual(['104', '7', '1500', null])
    expect(order('Gesägt', 'desc')).toEqual(['7', '1500', null, '104'])
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
      values: { [notiz.id]: [{ ...row('104').item.values[notiz.id][0], value: text }] },
      beams: 0,
      diameterClass: null,
      processed: false,
      beamTags: [],
      changed: '2026-10-31T10:00:00.000Z',
      changedDay: '2026-10-31',
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
  const filtered = (text: string) =>
    tags(applyFilters(rows, filtersFor({ ...query, tags: text }, columns)!))
  const query = { tags: '', filters: {}, sort: 'tag', dir: 'asc' as const }

  it('matches a number, a range and several parts; stems without a tag never', () => {
    expect(filtered('104')).toEqual(['104'])
    expect(filtered('100-120')).toEqual(['104'])
    expect(filtered('7, 1500')).toEqual(['7', '1500'])
    expect(filtered('all')).toEqual(['104', '7', '1500'])
    expect(filtered('8-99')).toEqual([])
  })

  it('has no filter without text and refuses text it cannot read', () => {
    expect(filtersFor(query, columns)).toEqual([])
    expect(tagFilter('abc')).toBeNull()
    expect(filtersFor({ ...query, tags: '100-' }, columns)).toBeNull()
    expect(filtersFor({ ...query, tags: '2000' }, columns)).toBeNull()
  })

  it('keeps only rows that pass every filter', () => {
    const none = () => false
    expect(applyFilters(rows, [tagFilter('104')!, none])).toEqual([])
    expect(applyFilters(rows, [tagFilter('7-104')!, tagFilter('100-200')!])).toHaveLength(1)
  })
})

describe('itemsText', () => {
  it('counts the stems, with a filter "von" all, with the singular', () => {
    expect(itemsText('stem', 130, 130, false)).toBe('130 Stämme')
    expect(itemsText('stem', 1, 1, false)).toBe('1 Stamm')
    expect(itemsText('stem', 34, 130, true)).toBe('34 von 130 Stämmen')
    expect(itemsText('stem', 1, 1, true)).toBe('1 von 1 Stamm')
    expect(itemsText('stem', 1, 1300, true)).toBe('1 von 1.300 Stämmen')
    expect(itemsText('beam', 130, 130, false)).toBe('130 Balken')
    expect(itemsText('beam', 1, 1, false)).toBe('1 Balken')
    expect(itemsText('beam', 34, 130, true)).toBe('34 von 130 Balken')
  })
})

describe('URL', () => {
  const columnIds = columns as Column[]
  const holzart = column('Holzart').id

  it('reads tags, sort and direction, and ignores a sort that is no column', () => {
    expect(readQuery({}, columnIds)).toEqual({ tags: '', filters: {}, sort: 'tag', dir: 'asc' })
    expect(readQuery({ tags: ' 100-120 ', sort: holzart, dir: 'desc' }, columnIds)).toEqual({
      tags: '100-120',
      filters: {},
      sort: holzart,
      dir: 'desc',
    })
    expect(readQuery({ sort: 'x', dir: 'up', tags: null }, columnIds)).toEqual({
      tags: '',
      filters: {},
      sort: 'tag',
      dir: 'asc',
    })
    expect(readQuery({ sort: ['beams', 'changed'] }, columnIds).sort).toBe('beams')
  })

  it('writes names instead of ids and still reads old links with ids', () => {
    const [eiche] = column('Holzart').attribute!.options
    const state = {
      tags: '',
      filters: { [holzart]: eiche.id, beams: '1~3', changed: '2026-10-01~' },
      sort: 'beams',
      dir: 'desc' as const,
    }
    const written = writeQuery(state, columnIds)
    expect(Object.keys(written)).toEqual(['Holzart', 'Balken', 'Geändert', 'sort', 'dir'])
    expect(written.sort).toBe('Balken')
    expect(written.Holzart).toBe(eiche.label)
    expect(readQuery(written, columnIds)).toEqual(state)
    expect(readQuery({ [`f.${holzart}`]: eiche.id, sort: 'beams' }, columnIds)).toEqual({
      tags: '',
      filters: { [holzart]: eiche.id },
      sort: 'beams',
      dir: 'asc',
    })
    // a name that is not (any more) a column is ignored
    expect(readQuery({ Gibtsnicht: 'has', sort: 'Gibtsnicht' }, columnIds)).toEqual(
      readQuery({}, columnIds),
    )
  })

  // Names the code does not know: each case is a clash the URL has to survive
  describe('ambiguous names', () => {
    const attribute = (id: string, name: string, extra: Partial<Attribute> = {}): Attribute => ({
      id,
      key: null,
      name,
      description: '',
      type: 'choice',
      unit: null,
      is_series: false,
      is_inheritable: false,
      applies_to: ['stem'],
      hidden_when: [],
      sort_order: 1,
      active: true,
      options: [],
      ...extra,
    })
    const options = (...labels: string[]) =>
      labels.map((label, index) => ({ id: `opt-${index}`, label, sort_order: index, active: true }))
    const cols = buildColumns(
      [
        attribute('a-tags', 'tags', {
          options: options('A b', 'C,d', 'none', 'Doppelt', 'Doppelt', 'Ä'),
        }),
        attribute('a-sort', 'sort'),
        attribute('a-dir', 'dir'),
        attribute('a-beams', 'Balken'),
        attribute('a-changed', 'Geändert'),
        attribute('a-beams-id', 'beams'),
        attribute('a-twin1', 'Zwilling'),
        attribute('a-twin2', 'Zwilling'),
        attribute('a-empty', '  '),
        attribute('a-ok', 'Länge mit Leerzeichen', { options: options('Ä') }),
      ],
      'stem',
    )

    it('falls back to the id for them and keeps the heading of the fixed columns', () => {
      const written = writeQuery(
        {
          tags: '',
          filters: Object.fromEntries(
            cols
              .filter((c) => c.kind !== 'tag')
              .map((c) => [c.id, c.kind === 'attribute' ? 'opt-0' : '1~2']),
          ),
          sort: 'beams',
          dir: 'asc',
        },
        cols,
      )
      expect(Object.keys(written).sort()).toEqual(
        [
          'Balken',
          'Bearbeitet',
          'Geändert',
          'Länge mit Leerzeichen',
          'Mittendurchmesser',
          'a-tags',
          'a-sort',
          'a-dir',
          'a-beams',
          'a-changed',
          'a-beams-id',
          'a-twin1',
          'a-twin2',
          'a-empty',
          'sort',
        ].sort(),
      )
      expect(written['Länge mit Leerzeichen']).toBe('Ä')
    })

    it('does not split an option with a comma, nor confuse "none" or twins', () => {
      const filters = { 'a-tags': 'opt-0,opt-1,none,opt-2,opt-3,opt-5' }
      const written = writeQuery({ tags: '', filters, sort: 'tag', dir: 'asc' }, cols)
      expect(written['a-tags']).toBe('A b,opt-1,none,opt-2,opt-3,Ä')
      expect(readQuery(written, cols).filters).toEqual(filters)
      // an option that does not exist is dropped, none left = no filter
      expect(readQuery({ 'a-tags': 'A b,Gibtsnicht' }, cols).filters).toEqual({ 'a-tags': 'opt-0' })
      expect(readQuery({ 'a-tags': 'Gibtsnicht' }, cols).filters).toEqual({})
    })

    it('reads sort by name, and a name that is a URL word never means a column', () => {
      expect(readQuery({ sort: 'Balken' }, cols).sort).toBe('beams')
      expect(readQuery({ sort: 'beams' }, cols).sort).toBe('beams')
      expect(readQuery({ sort: 'tags' }, cols).sort).toBe('tag')
      expect(readQuery({ sort: 'Zwilling' }, cols).sort).toBe('tag')
      expect(readQuery({ sort: 'a-twin2' }, cols).sort).toBe('a-twin2')
    })
  })

  it('writes only what is not the default, and reads back what it wrote', () => {
    expect(writeQuery({ tags: '', filters: {}, sort: 'tag', dir: 'asc' }, columnIds)).toEqual({})
    expect(writeQuery({ tags: '104', filters: {}, sort: 'beams', dir: 'desc' }, columnIds)).toEqual(
      {
        tags: '104',
        sort: 'Balken',
        dir: 'desc',
      },
    )
    for (const state of [
      { tags: '1-10,15', filters: {}, sort: holzart, dir: 'asc' as const },
      { tags: '', filters: {}, sort: 'tag', dir: 'desc' as const },
    ]) {
      expect(readQuery(writeQuery(state, columnIds), columnIds)).toEqual(state)
    }
  })

  it('flips the direction on the same column, starts ascending on another', () => {
    const state = { tags: '104', filters: {}, sort: 'tag', dir: 'asc' as const }
    expect(sortBy(state, 'tag')).toEqual({ ...state, dir: 'desc' })
    expect(sortBy({ ...state, dir: 'desc' }, 'tag').dir).toBe('asc')
    expect(sortBy({ ...state, dir: 'desc' }, 'beams')).toEqual({
      tags: '104',
      filters: {},
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

describe('"Mittendurchmesser" and "Bearbeitet"', () => {
  const stems: [string, StemSpec, number?][] = [
    ['1', { max: 32.6, min: 32.4, sawn: true }], // mean 32,5 → 33 → class 32
    ['2', { max: 40, min: 39 }, 2], // sawn into two beams, class 40
    ['3', { max: 31, unsawable: true }], // one diameter, class 30
    ['4', { sawn: true }], // processed without diameter
    ['5', { max: 50, min: 50 }], // open, class 50
    ['6', {}], // open, no diameter
  ]
  const snapshot = processingSnapshot(
    stems.flatMap(([tag, spec, beams]) => stemWithBeams(tag, spec, beams)),
  )
  const stemColumns = buildColumns(snapshot.attributes, 'stem')
  const stemRows = buildRows(snapshot, 'stem', stemColumns)
  const by = (id: string) => (row: Row) => row.cells[id].text
  const textOf = (id: string) =>
    Object.fromEntries(stemRows.map((r) => [r.item.tag_number, by(id)(r)]))
  const sorted = (id: string, dir: 'asc' | 'desc') =>
    tags(
      sortRows(
        stemRows,
        stemColumns.find((c) => c.id === id)!,
        dir,
      ),
    )
  const shown = (query: Record<string, string>) => {
    const filters = filtersFor(readQuery(query, stemColumns), stemColumns)!
    return tags(applyFilters(stemRows, filters))
  }

  it('are fixed columns of the list of stems, right before "Balken", and not in the list of beams', () => {
    const labels = stemColumns.map((c) => c.label)
    expect(labels.slice(-3)).toEqual(['Bearbeitet', 'Balken', 'Geändert'])
    expect(buildColumns(processingAttributes, 'beam').map((c) => c.kind)).not.toContain('diameter')
    expect(buildColumns(processingAttributes, 'beam').map((c) => c.kind)).not.toContain('processed')
  })

  it('puts the class right behind the later of the two diameter columns, or before "Bearbeitet" without them', () => {
    const labelsOf = (list: Attribute[]) =>
      buildColumns(list, 'stem').map((c) => (c.kind === 'attribute' ? c.attribute!.key : c.kind))
    const [max, min, ...rest] = processingAttributes
    expect(labelsOf(processingAttributes)).toEqual([
      'tag',
      'mid_diameter_max',
      'mid_diameter_min',
      'diameter',
      'sawn',
      'unsawable',
      'sawn_cross_section',
      'processed',
      'beams',
      'changed',
    ])
    // V29 order decides, not the position in the list
    expect(labelsOf([{ ...max, sort_order: 9 }, min, ...rest])).toEqual([
      'tag',
      'mid_diameter_min',
      'sawn',
      'unsawable',
      'sawn_cross_section',
      'mid_diameter_max',
      'diameter',
      'processed',
      'beams',
      'changed',
    ])
    // one of them inactive: behind the other
    expect(labelsOf([{ ...max, active: false }, min, ...rest]).slice(0, 3)).toEqual([
      'tag',
      'mid_diameter_min',
      'diameter',
    ])
    // both inactive: before "Bearbeitet"
    expect(labelsOf([{ ...max, active: false }, { ...min, active: false }, ...rest])).toEqual([
      'tag',
      'sawn',
      'unsawable',
      'sawn_cross_section',
      'diameter',
      'processed',
      'beams',
      'changed',
    ])
  })

  it('show the class as the two whole cm, "–" without a diameter, and ja or nein', () => {
    expect(textOf('diameter')).toEqual({
      '1': '32–33 cm',
      '2': '40–41 cm',
      '3': '30–31 cm',
      '4': null,
      '5': '50–51 cm',
      '6': null,
    })
    expect(textOf('processed')).toEqual({
      '1': 'ja',
      '2': 'ja',
      '3': 'ja',
      '4': 'ja',
      '5': 'nein',
      '6': 'nein',
    })
  })

  it('sort by class with "–" last either way, and "ja" before "nein"', () => {
    expect(sorted('diameter', 'asc')).toEqual(['3', '1', '2', '5', '4', '6'])
    expect(sorted('diameter', 'desc')).toEqual(['5', '2', '1', '3', '4', '6'])
    expect(sorted('processed', 'asc')).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(sorted('processed', 'desc')).toEqual(['5', '6', '1', '2', '3', '4'])
  })

  it('filter by the class, "Nicht erfasst" and ja or nein, all combined', () => {
    expect(shown({ Mittendurchmesser: '32' })).toEqual(['1'])
    expect(shown({ Mittendurchmesser: '32,40' })).toEqual(['1', '2'])
    expect(shown({ Mittendurchmesser: 'none' })).toEqual(['4', '6'])
    expect(shown({ Bearbeitet: 'yes' })).toEqual(['1', '2', '3', '4'])
    expect(shown({ Bearbeitet: 'no' })).toEqual(['5', '6'])
    expect(shown({ Bearbeitet: 'yes', Mittendurchmesser: 'none' })).toEqual(['4'])
    // yes/no has no "Nicht erfasst": an old link with it loses that value
    expect(readQuery({ Bearbeitet: 'yes,none' }, stemColumns).filters.processed).toBe('yes')
    // a filter that is no class is unreadable
    expect(
      filtersFor(readQuery({ Mittendurchmesser: 'groß' }, stemColumns), stemColumns),
    ).toBeNull()
  })

  it('keep their heading in the URL even if an attribute is called the same', () => {
    const named = buildColumns(
      processingAttributes.map((a) => (a.key === 'sawn' ? { ...a, name: 'Bearbeitet' } : a)),
      'stem',
    )
    const written = writeQuery(
      { tags: '', filters: { processed: 'yes', 'a-sawn': 'yes' }, sort: 'tag', dir: 'asc' },
      named,
    )
    expect(written).toEqual({ Bearbeitet: 'yes', 'a-sawn': 'yes' })
  })

  // The link of a row of the dashboard card shows the list with exactly the stems the row counts.
  describe('the link of the dashboard card', () => {
    const byDiameter = (dashboardFixture as DashboardResponse).sections.find(
      (section): section is DashboardDiameterSection => section.type === 'diameter_classes',
    )!
    // Per row of the card as many processed stems of its class as it counts (the first ones unsawable), per class one open stem as noise,
    // and the stems without a diameter: processed ones as many as the card counts, one open
    const items = [
      ...byDiameter.rows.flatMap((row) => [
        ...Array.from(
          { length: row.stems },
          (_, index) =>
            stemWithBeams(`${row.from_cm}${index}`, {
              max: row.from_cm + 1.5,
              min: row.from_cm + 0.5,
              ...(index < row.not_sawable ? { unsawable: true } : { sawn: true }),
            })[0],
        ),
        stemWithBeams(`${row.from_cm}x`, { max: row.from_cm, min: row.from_cm })[0],
      ]),
      ...Array.from(
        { length: byDiameter.without_diameter },
        (_, index) => stemWithBeams(`n${index}`, { sawn: true })[0],
      ),
      stemWithBeams('open', {})[0],
    ]
    const cardSnapshot = processingSnapshot(items)
    const cardColumns = buildColumns(cardSnapshot.attributes, 'stem')
    const cardRows = buildRows(cardSnapshot, 'stem', cardColumns)
    const count = (fromCm: number | null) =>
      applyFilters(
        cardRows,
        filtersFor(readQuery(processedStemsLink(fromCm), cardColumns), cardColumns)!,
      ).length

    it('names the two filters with their headings', () => {
      expect(processedStemsLink(32)).toEqual({ Mittendurchmesser: '32', Bearbeitet: 'yes' })
      expect(processedStemsLink(null)).toEqual({ Mittendurchmesser: 'none', Bearbeitet: 'yes' })
    })

    it('counts, for every row of the card, the stems the row counts', () => {
      expect(byDiameter.rows.length).toBeGreaterThan(1)
      for (const row of byDiameter.rows) expect(count(row.from_cm)).toBe(row.stems)
      expect(count(null)).toBe(byDiameter.without_diameter)
    })
  })
})
