import { describe, expect, it } from 'vitest'
import type { Attribute, AttributeType, Snapshot, TimberItem } from '@v29/shared/contract'

import {
  applyFilters,
  chipOf,
  countText,
  filterType,
  describePicks,
  isReadableTags,
  offersNone,
  parseTags,
  tagFilter,
  matchesFilter,
  pickOptions,
  readFilter,
  writeFilter,
  type ColumnFilter,
} from '@/listFilters'
import {
  buildColumns,
  buildRows,
  columnFilters,
  filtersFor,
  readQuery,
  writeQuery,
  type Column,
  type Row,
} from '@/stemlist'

const tags = (list: Row[]) => list.map((candidate) => candidate.item.tag_number)

// Column filters. The attributes here are named after nothing the code knows: the filter follows the type alone.
describe('column filters', () => {
  let counter = 0
  const attribute = (type: AttributeType, extra: Partial<Attribute> = {}): Attribute => ({
    id: `attr-${type}`,
    key: null,
    name: `Zufallsmerkmal ${type}`,
    description: '',
    type,
    unit: null,
    is_series: false,
    is_inheritable: false,
    applies_to: ['stem'],
    hidden_when: [],
    sort_order: ++counter,
    active: true,
    options: [],
    ...extra,
  })
  const option = (id: string, label: string, sort_order: number, active = true) => ({
    id,
    label,
    sort_order,
    active,
  })
  const attrs = [
    attribute('choice', {
      options: [
        option('o-eins', 'Eins', 1),
        option('o-zwei', 'Zwei', 2),
        option('o-alt', 'Alt', 3, false),
      ],
    }),
    attribute('boolean'),
    attribute('number', { unit: 'cm', is_series: true }),
    attribute('month'),
    attribute('date'),
    attribute('text', { is_series: true }),
    attribute('photo', { is_series: true }),
  ]
  const id = (type: AttributeType) => `attr-${type}`
  const rec = (value: string | number | boolean, at = '2026-10-01T10:00:00.000Z') => ({
    value,
    recorded_at: at,
    user_id: 'u',
    event_id: `e-${++counter}`,
  })
  const stem = (
    tag: string,
    values: TimberItem['values'],
    created_at = '2026-09-01T10:00:00.000Z',
  ) =>
    ({
      id: `s-${tag}`,
      parent_id: null,
      tag_number: tag,
      has_children: false,
      created_at,
      created_by: 'u',
      values,
    }) as TimberItem
  const beam = (of: string, letter: string, values: TimberItem['values']): TimberItem => ({
    ...stem(`${of}-${letter}`, values),
    id: `b-${of}-${letter}`,
    parent_id: `s-${of}`,
  })

  const snapshot: Snapshot = {
    schema_version: 1,
    generated_at: '2026-11-01T00:00:00.000Z',
    users: [],
    attributes: attrs,
    timber_items: [
      stem('1', {
        [id('choice')]: [rec('o-eins')],
        [id('boolean')]: [rec(true)],
        [id('number')]: [
          rec(50, '2026-10-01T10:00:00.000Z'),
          rec(35.5, '2026-10-02T10:00:00.000Z'),
        ],
        [id('month')]: [rec('2026-10')],
        [id('date')]: [rec('2026-10-31')],
        [id('text')]: [
          rec('Leicht krumm', '2026-10-01T10:00:00.000Z'),
          rec('gerade', '2026-10-02T10:00:00.000Z'),
        ],
        [id('photo')]: [rec('p1'), rec('p2')],
      }),
      stem('2', {
        [id('choice')]: [rec('o-alt')],
        [id('boolean')]: [rec(false)],
        [id('number')]: [rec(40)],
        [id('month')]: [rec('2026-12')],
        [id('date')]: [rec('2026-11-15')],
        [id('text')]: [rec('Sehr krumm')],
      }),
      stem('3', {}, '2026-10-31T23:30:00.000Z'),
      stem('4', { [id('choice')]: [rec('o-zwei')], [id('number')]: [rec(0)] }),
      // The beam carries the note and the photo: its stem must not be found by them
      stem('5', {}),
      beam('5', 'A', { [id('text')]: [rec('krumm')], [id('photo')]: [rec('p3')] }),
      beam('5', 'B', {}),
    ],
  }
  const cols = buildColumns(attrs, 'stem')
  const all = buildRows(snapshot, 'stem', cols)
  const col = (type: FilterTypeName) =>
    cols.find((c) => c.id === `attr-${type}` || c.kind === type)!
  type FilterTypeName = AttributeType | 'beams' | 'changed'
  const pass = (column: Column, filter: ColumnFilter) =>
    tags(all.filter((candidate) => matchesFilter(candidate, column, filter)))
  const range = (from: string, to: string): ColumnFilter => ({ kind: 'range', from, to })

  it('has a filter for every column but the stem, by type', () => {
    expect(cols.map((c) => filterType(c))).toEqual([
      null,
      'choice',
      'boolean',
      'number',
      'month',
      'date',
      'text',
      'photo',
      'count',
      'date',
    ])
  })

  it('choice: any of the ticked options, "not recorded" apart; an unknown option matches nothing', () => {
    const column = col('choice')
    expect(pass(column, { kind: 'pick', picks: ['o-eins', 'o-zwei'] })).toEqual(['1', '4'])
    expect(pass(column, { kind: 'pick', picks: ['o-eins', 'none'] })).toEqual(['1', '3', '5'])
    expect(pass(column, { kind: 'pick', picks: ['none'] })).toEqual(['3', '5'])
    expect(pass(column, { kind: 'pick', picks: ['o-gibtsnicht'] })).toEqual([])
  })

  it('boolean: no value is "nein"', () => {
    const column = col('boolean')
    expect(pass(column, { kind: 'pick', picks: ['yes'] })).toEqual(['1'])
    expect(pass(column, { kind: 'pick', picks: ['no'] })).toEqual(['2', '3', '4', '5'])
    expect(pass(column, { kind: 'pick', picks: ['yes', 'no'] })).toEqual(['1', '2', '3', '4', '5'])
  })

  it('number: both ends included, one end may be missing, 0 is a value, "not recorded" apart; a series counts by its latest value', () => {
    const column = col('number')
    expect(pass(column, range('30', '40'))).toEqual(['1', '2'])
    expect(pass(column, range('35.5', '35.5'))).toEqual(['1'])
    expect(pass(column, range('36', ''))).toEqual(['2'])
    expect(pass(column, range('', '35.5'))).toEqual(['1', '4'])
    expect(pass(column, range('50', ''))).toEqual([])
    expect(pass(column, { kind: 'none' })).toEqual(['3', '5'])
  })

  it('month: any of the ticked months, combined with "not recorded"', () => {
    const column = col('month')
    expect(pass(column, { kind: 'pick', picks: ['2026-10'] })).toEqual(['1'])
    expect(pass(column, { kind: 'pick', picks: ['2026-10', '2026-12'] })).toEqual(['1', '2'])
    expect(pass(column, { kind: 'pick', picks: ['2026-12', 'none'] })).toEqual(['2', '3', '4', '5'])
    expect(pass(column, { kind: 'pick', picks: ['2020-01'] })).toEqual([])
  })

  it('offers the months of the rows, newest first, without doubles, the inherited ones of a beam too, and one of the URL that no row has', () => {
    const month = (value: string) => ({ [id('month')]: [rec(value)] })
    const items = [
      stem('1', month('2026-10')),
      stem('2', month('2026-12')),
      stem('3', month('2026-10')),
    ]
    const labels = (rows: Row[], picks: string[] = []) =>
      pickOptions(col('month'), rows, picks).map((o) => [o.id, o.label])
    const rows = buildRows({ ...snapshot, timber_items: items }, 'stem', cols)
    expect(labels(rows)).toEqual([
      ['2026-12', 'Dezember 2026'],
      ['2026-10', 'Oktober 2026'],
    ])
    expect(labels(rows, ['2025-03', 'none'])).toEqual([
      ['2026-12', 'Dezember 2026'],
      ['2026-10', 'Oktober 2026'],
      ['2025-03', 'März 2025'],
    ])
    // a beam has the month of its stem as its own, inherited value in the snapshot
    const beamAttrs = attrs.map((a) => ({ ...a, applies_to: ['beam' as const] }))
    const beams = buildRows(
      { ...snapshot, attributes: beamAttrs, timber_items: [beam('1', 'A', month('2027-01'))] },
      'beam',
      buildColumns(beamAttrs, 'beam'),
    )
    expect(labels(beams)).toEqual([['2027-01', 'Januar 2027']])
    expect(labels([])).toEqual([])
  })

  it('date: from–to by time, one end may be missing, "not recorded" apart', () => {
    expect(pass(col('date'), range('2026-10-31', '2026-11-15'))).toEqual(['1', '2'])
    expect(pass(col('date'), range('', '2026-10-30'))).toEqual([])
    expect(pass(col('date'), { kind: 'none' })).toEqual(['3', '4', '5'])
  })

  it('text: a part of a word in any text of the series, not in the notes of beams; present; not recorded', () => {
    const column = col('text')
    expect(pass(column, { kind: 'contains', text: 'KRUMM' })).toEqual(['1', '2'])
    // only in the older text of the series (the column shows "gerade")
    expect(pass(column, { kind: 'contains', text: 'leicht' })).toEqual(['1'])
    expect(pass(column, { kind: 'contains', text: 'rum' })).toEqual(['1', '2'])
    expect(pass(column, { kind: 'has' })).toEqual(['1', '2'])
    expect(pass(column, { kind: 'none' })).toEqual(['3', '4', '5'])
  })

  it('photo: with or without photos; the photos of beams do not count', () => {
    expect(pass(col('photo'), { kind: 'has' })).toEqual(['1'])
    expect(pass(col('photo'), { kind: 'none' })).toEqual(['2', '3', '4', '5'])
  })

  it('beams: a number from–to, 0 is a stem that is not split', () => {
    const column = col('beams')
    expect(pass(column, range('0', '0'))).toEqual(['1', '2', '3', '4'])
    expect(pass(column, range('1', ''))).toEqual(['5'])
    expect(pass(column, range('', '1'))).toEqual(['1', '2', '3', '4'])
    expect(pass(column, range('3', '4'))).toEqual([])
  })

  it('changed: from–to by German day, both included', () => {
    const column = col('changed')
    // stem 3 was created at 23:30 UTC on 31 October: that is 1 November in Berlin
    expect(pass(column, range('2026-11-01', '2026-11-01'))).toEqual(['3'])
    expect(pass(column, range('2026-10-31', '2026-10-31'))).toEqual([])
    expect(pass(column, range('2026-10-02', '2026-11-01'))).toEqual(['1', '3'])
  })

  it('combines every filter, the field "Kennung" included, with and', () => {
    const query = {
      tags: '1-3',
      filters: {} as Record<string, string>,
      sort: 'tag',
      dir: 'asc' as const,
    }
    query.filters[id('number')] = '30~40'
    query.filters[id('text')] = 'contains:krumm'
    expect(tags(applyFilters(all, filtersFor(query, cols)!))).toEqual(['1', '2'])
    query.filters[id('boolean')] = 'no'
    expect(tags(applyFilters(all, filtersFor(query, cols)!))).toEqual(['2'])
    query.tags = '1'
    expect(tags(applyFilters(all, filtersFor(query, cols)!))).toEqual([])
  })

  it('reads and writes the URL form, and refuses what it cannot read', () => {
    const forms: [AttributeType | 'count', string, ColumnFilter][] = [
      ['choice', 'o-eins,none', { kind: 'pick', picks: ['o-eins', 'none'] }],
      ['boolean', 'yes,no', { kind: 'pick', picks: ['yes', 'no'] }],
      ['number', '30.5~40', range('30.5', '40')],
      ['number', '~40', range('', '40')],
      ['number', 'none', { kind: 'none' }],
      ['month', '2026-10,none', { kind: 'pick', picks: ['2026-10', 'none'] }],
      ['date', '2026-10-01~2026-10-31', range('2026-10-01', '2026-10-31')],
      ['text', 'contains:krumm', { kind: 'contains', text: 'krumm' }],
      ['text', 'has', { kind: 'has' }],
      ['photo', 'none', { kind: 'none' }],
      ['count', '0~2', range('0', '2')],
    ]
    for (const [type, text, filter] of forms) {
      expect(readFilter(type, text)).toEqual(filter)
      expect(writeFilter(filter)).toBe(text)
    }
    const unreadable: [AttributeType | 'count', string][] = [
      ['boolean', 'maybe'],
      ['boolean', 'none'],
      ['number', 'abc~'],
      ['number', '~'],
      ['number', '1~2~3'],
      ['month', '2026-13'],
      ['month', '2026-10~2026-11'],
      ['month', '10/2026'],
      ['date', '2026-02-30~'],
      ['text', 'contains:'],
      ['text', 'x'],
      ['photo', 'maybe'],
      ['count', 'none'],
      ['count', '-1~'],
    ]
    for (const [type, text] of unreadable)
      expect(readFilter(type, text), `${type} ${text}`).toBeNull()
    // typed German forms
    expect(readFilter('number', '30,5~')).toEqual(range('30.5', ''))
  })

  it('keeps the filters in the URL and ignores one of a column that does not exist', () => {
    const state = {
      tags: '',
      filters: { [id('number')]: '30~40', [id('photo')]: 'has' },
      sort: 'tag',
      dir: 'asc' as const,
    }
    expect(writeQuery(state, cols)).toEqual({
      [col('number').label]: '30~40',
      [col('photo').label]: 'has',
    })
    expect(readQuery(writeQuery(state, cols), cols)).toEqual(state)
    expect(readQuery({ 'f.gibtsnicht': 'has', 'f.tag': 'x' }, cols).filters).toEqual({})
    // an old link with a range of months sets no filter, and months are ticks like a choice
    expect(readQuery({ [`f.${id('month')}`]: '2026-10~2026-11' }, cols).filters).toEqual({})
    expect(readQuery({ [`f.${id('month')}`]: '2026-10,2026-11' }, cols).filters).toEqual({
      [id('month')]: '2026-10,2026-11',
    })
    // unreadable stays in the state, so that the list can say so
    const bad = readQuery({ [`f.${id('number')}`]: 'abc' }, cols)
    expect(columnFilters(bad, cols)).toEqual([{ column: col('number'), filter: null }])
    expect(filtersFor(bad, cols)).toBeNull()
  })

  it('offers the options in V29 order, an inactive one only if a stem still has it, and "ja" and "nein"', () => {
    expect(pickOptions(col('choice'), all).map((o) => o.label)).toEqual(['Eins', 'Zwei', 'Alt'])
    expect(
      pickOptions(
        col('choice'),
        all.filter((r) => r.item.tag_number !== '2'),
      ).map((o) => o.label),
    ).toEqual(['Eins', 'Zwei'])
    expect(pickOptions(col('boolean'), all).map((o) => o.label)).toEqual(['ja', 'nein'])
  })

  it('says a filter in words, as the chip shows it', () => {
    const chip = (type: FilterTypeName, filter: ColumnFilter) => chipOf(col(type), filter).text
    // a choice lists up to two values in V29 order, "Nicht erfasst" last; from three on it only counts
    expect(chip('choice', { kind: 'pick', picks: ['o-zwei', 'none', 'o-eins'] })).toBe(
      'Zufallsmerkmal choice: 3 ausgewählt',
    )
    expect(chip('choice', { kind: 'pick', picks: ['o-zwei', 'o-eins'] })).toBe(
      'Zufallsmerkmal choice: Eins, Zwei',
    )
    expect(chip('choice', { kind: 'pick', picks: ['none', 'o-zwei'] })).toBe(
      'Zufallsmerkmal choice: Zwei, Nicht erfasst',
    )
    expect(chip('choice', { kind: 'pick', picks: ['o-zwei'] })).toBe('Zufallsmerkmal choice: Zwei')
    expect(chip('boolean', { kind: 'pick', picks: ['yes'] })).toBe('Zufallsmerkmal boolean: ja')
    expect(chip('boolean', { kind: 'pick', picks: ['no', 'yes'] })).toBe(
      'Zufallsmerkmal boolean: ja, nein',
    )
    expect(chip('number', range('30', '40'))).toBe('Zufallsmerkmal number: 30–40 cm')
    expect(chip('number', range('30.5', ''))).toBe('Zufallsmerkmal number: ab 30,5 cm')
    expect(chip('number', range('', '40'))).toBe('Zufallsmerkmal number: bis 40 cm')
    expect(chip('number', { kind: 'none' })).toBe('Zufallsmerkmal number: Nicht erfasst')
    // months in words, newest first like the checklist, whatever the order of the picks
    expect(chip('month', { kind: 'pick', picks: ['2026-10', '2026-11'] })).toBe(
      'Zufallsmerkmal month: November 2026, Oktober 2026',
    )
    expect(chip('month', { kind: 'pick', picks: ['none', '2026-10'] })).toBe(
      'Zufallsmerkmal month: Oktober 2026, Nicht erfasst',
    )
    expect(chip('month', { kind: 'pick', picks: ['2026-10', '2026-11', '2026-12'] })).toBe(
      'Zufallsmerkmal month: 3 ausgewählt',
    )
    expect(chip('date', range('2026-10-01', ''))).toBe('Zufallsmerkmal date: ab 01.10.2026')
    expect(chip('text', { kind: 'contains', text: 'krumm' })).toBe(
      'Zufallsmerkmal text: enthält krumm',
    )
    expect(chip('text', { kind: 'has' })).toBe('Zufallsmerkmal text: vorhanden')
    expect(chip('photo', { kind: 'none' })).toBe('Zufallsmerkmal photo: ohne Fotos')
    expect(chip('beams', range('1', '3'))).toBe('Balken: 1–3')
    // the chip knows the column it belongs to and the name for "Filter … entfernen"
    expect(chipOf(col('boolean'), { kind: 'pick', picks: ['yes'] })).toMatchObject({
      id: 'attr-boolean',
      name: 'Zufallsmerkmal boolean',
    })
  })

  it('serves the beam list with the same logic: columns of the attributes of beams, no column for beams of beams', () => {
    const beamAttribute = attribute('boolean', {
      id: 'attr-beam',
      name: 'Nur Balken',
      applies_to: ['beam'],
    })
    const beamSnapshot = { ...snapshot, attributes: [...attrs, beamAttribute] }
    const beamColumns = buildColumns(beamSnapshot.attributes, 'beam')
    expect(beamColumns.map((c) => c.label)).toEqual(['Balken', 'Nur Balken', 'Geändert'])
    expect(buildColumns(beamSnapshot.attributes, 'stem').map((c) => c.label)).not.toContain(
      'Nur Balken',
    )
    // the rows are the beams; they can be filtered by their own values like stems
    const beamRows = buildRows(
      {
        ...beamSnapshot,
        timber_items: beamSnapshot.timber_items.map((item) =>
          item.tag_number === '5-A' ? { ...item, values: { 'attr-beam': [rec(true)] } } : item,
        ),
      },
      'beam',
      beamColumns,
    )
    expect(tags(beamRows)).toEqual(['5-A', '5-B'])
    const column = beamColumns.find((c) => c.id === 'attr-beam')!
    expect(chipOf(column, { kind: 'pick', picks: ['yes'] }).text).toBe('Nur Balken: ja')
    expect(
      tags(beamRows.filter((r) => matchesFilter(r, column, { kind: 'pick', picks: ['yes'] }))),
    ).toEqual(['5-A'])
  })

  describe('tagFilter', () => {
    // Stem 5 has the beams 5-A and 5-B (see the snapshot above)
    const found = (text: string, list: Row[] = all) => tags(applyFilters(list, [tagFilter(text)!]))

    it('finds the stem that has a beam of the tag, in any spelling, but not the other stems', () => {
      expect(found('5-A')).toEqual(['5'])
      expect(found('5b')).toEqual(['5'])
      expect(found('0005-a')).toEqual(['5'])
      expect(found('5-C')).toEqual([])
      expect(found('4-A')).toEqual([])
    })

    it('mixes with numbers and ranges, and a number still finds the stem', () => {
      expect(found('1,5-A')).toEqual(['1', '5'])
      expect(found('3-4,5-B')).toEqual(['3', '4', '5'])
      expect(found('5')).toEqual(['5'])
    })

    it('finds only the beam itself in a list of beams', () => {
      const beams = buildRows(snapshot, 'beam', buildColumns(attrs, 'beam'))
      expect(found('5-A', beams)).toEqual(['5-A'])
      expect(found('5', beams)).toEqual(['5-A', '5-B'])
      expect(found('5-C', beams)).toEqual([])
    })

    it('is null for what the server would refuse', () => {
      expect(tagFilter('5-AB')).toBeNull()
      expect(tagFilter('1-5A')).toBeNull()
    })
  })

  it('drops "Nicht erfasst" from the URL of a yes/no filter, the other picks stay', () => {
    const name = id('boolean')
    expect(readQuery({ [`f.${name}`]: 'none' }, cols).filters).toEqual({})
    expect(readQuery({ [`f.${name}`]: 'yes,none' }, cols).filters).toEqual({ [name]: 'yes' })
    // a choice keeps it
    expect(readQuery({ [`f.${id('choice')}`]: 'none' }, cols).filters).toEqual({
      [id('choice')]: 'none',
    })
  })

  describe('"Nicht erfasst" of "Geändert"', () => {
    const cols = buildColumns(attrs, 'stem')
    const column = (kind: string) => cols.find((c) => c.kind === kind)!

    it('is offered for every column but the beams, "Geändert", which every item has, and yes/no, where no value is "nein"', () => {
      expect(cols.map((c) => [c.label, c.kind === 'tag' || offersNone(c)])).toEqual(
        cols.map((c) => [
          c.label,
          !['beams', 'changed'].includes(c.kind) && c.attribute?.type !== 'boolean',
        ]),
      )
    })

    it('makes an old link with it an unreadable filter', () => {
      const state = readQuery({ 'f.changed': 'none' }, cols)
      expect(columnFilters(state, cols)).toEqual([{ column: column('changed'), filter: null }])
      expect(filtersFor(state, cols)).toBeNull()
      expect(readFilter('date', 'none', false)).toBeNull()
      // a range is still read, and other date filters keep "none"
      expect(readFilter('date', '2026-10-01~', false)).toEqual({
        kind: 'range',
        from: '2026-10-01',
        to: '',
      })
      expect(readFilter('date', 'none')).toEqual({ kind: 'none' })
      expect(filtersFor(readQuery({ 'f.attr-date': 'none' }, cols), cols)).not.toBeNull()
    })
  })
})

describe('counting texts', () => {
  it('counts with the singular and puts the dative after "von"', () => {
    const entries: [string, string, string] = ['Eintrag', 'Einträge', 'Einträgen']
    expect(countText(1, 1, false, entries)).toBe('1 Eintrag')
    expect(countText(248, 248, false, entries)).toBe('248 Einträge')
    expect(countText(12, 1300, true, entries)).toBe('12 von 1.300 Einträgen')
  })
})

describe('parseTags', () => {
  it('reads numbers, ranges and beam tags, mixed, with the spellings of a beam tag', () => {
    expect(parseTags('104')).toEqual({ ranges: [[104, 104]], beams: [] })
    expect(parseTags('100-120,104-A')).toEqual({ ranges: [[100, 120]], beams: ['104-A'] })
    for (const spelling of ['104-A', '104-a', '104A', '104a', '0104-A', ' 104 - a ']) {
      expect({ spelling, tags: parseTags(spelling) }).toEqual({
        spelling,
        tags: { ranges: [], beams: ['104-A'] },
      })
    }
    expect(parseTags('7b, 3-9,1999z')).toEqual({ ranges: [[3, 9]], beams: ['7-B', '1999-Z'] })
    expect(parseTags('all')).toEqual({ ranges: [[1, 1999]], beams: [] })
  })

  it('refuses ranges of beams, several letters, numbers out of range and "all" next to others', () => {
    for (const text of [
      '100-120A',
      '104-AB',
      '0-A',
      '2000-A',
      '104-A,',
      'all,104-A',
      'A',
      '104--A',
    ])
      expect({ text, tags: parseTags(text) }).toEqual({ text, tags: null })
  })
})

describe('describePicks', () => {
  it('lists up to two, then counts', () => {
    expect(describePicks(['Mara'], 1)).toBe('Mara')
    expect(describePicks(['Mara', 'Sägewerk Muster'], 2)).toBe(
      'Mara, Sägewerk Muster',
    )
    expect(describePicks(['a', 'b', 'c'], 3)).toBe('3 ausgewählt')
    // more picks than names: the ones that are not offered any more count too
    expect(describePicks(['a', 'b'], 3)).toBe('3 ausgewählt')
  })
})

describe('isReadableTags', () => {
  it('accepts what the server reads: numbers, ranges, beam tags, lists, "all", blanks and zeros around', () => {
    for (const text of [
      '104',
      ' 104 ',
      '0104',
      '100-130',
      '100 - 130',
      '1-10,15,20-25',
      '1999',
      'all',
      '104-A',
      '104a',
      '100-120,104-A',
    ])
      expect({ text, ok: isReadableTags(text) }).toEqual({ text, ok: true })
  })

  it('refuses what is incomplete or out of range', () => {
    for (const text of ['', '100-', '-5', 'abc', '0', '2000', '130-100', '1,,2', '1-10,', '10 5'])
      expect({ text, ok: isReadableTags(text) }).toEqual({ text, ok: false })
  })
})
