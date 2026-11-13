import { describe, expect, it } from 'vitest'
import type { Attribute, AttributeType, Snapshot, TimberItem } from '@v29/shared/contract'

import {
  applyFilters,
  chipOf,
  countText,
  filterType,
  isReadableTags,
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

  it('boolean: "ja", "nein" and "not recorded" are three different things', () => {
    const column = col('boolean')
    expect(pass(column, { kind: 'pick', picks: ['yes'] })).toEqual(['1'])
    expect(pass(column, { kind: 'pick', picks: ['no'] })).toEqual(['2'])
    expect(pass(column, { kind: 'pick', picks: ['none'] })).toEqual(['3', '4', '5'])
    expect(pass(column, { kind: 'pick', picks: ['yes', 'no'] })).toEqual(['1', '2'])
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

  it('month and date: from–to by time, one end may be missing, "not recorded" apart', () => {
    expect(pass(col('month'), range('2026-10', '2026-11'))).toEqual(['1'])
    expect(pass(col('month'), range('2026-11', ''))).toEqual(['2'])
    expect(pass(col('month'), { kind: 'none' })).toEqual(['3', '4', '5'])
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
      ['boolean', 'yes,no,none', { kind: 'pick', picks: ['yes', 'no', 'none'] }],
      ['number', '30.5~40', range('30.5', '40')],
      ['number', '~40', range('', '40')],
      ['number', 'none', { kind: 'none' }],
      ['month', '2026-10~', range('2026-10', '')],
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
      ['number', 'abc~'],
      ['number', '~'],
      ['number', '1~2~3'],
      ['month', '2026-13~'],
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
    expect(writeQuery(state)).toEqual({
      [`f.${id('number')}`]: '30~40',
      [`f.${id('photo')}`]: 'has',
    })
    expect(readQuery(writeQuery(state), cols)).toEqual(state)
    expect(readQuery({ 'f.gibtsnicht': 'has', 'f.tag': 'x' }, cols).filters).toEqual({})
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
    expect(chip('boolean', { kind: 'pick', picks: ['no', 'yes', 'none'] })).toBe(
      'Zufallsmerkmal boolean: 3 ausgewählt',
    )
    expect(chip('number', range('30', '40'))).toBe('Zufallsmerkmal number: 30–40 cm')
    expect(chip('number', range('30.5', ''))).toBe('Zufallsmerkmal number: ab 30,5 cm')
    expect(chip('number', range('', '40'))).toBe('Zufallsmerkmal number: bis 40 cm')
    expect(chip('number', { kind: 'none' })).toBe('Zufallsmerkmal number: Nicht erfasst')
    expect(chip('month', range('2026-10', '2026-12'))).toBe('Zufallsmerkmal month: 10/2026–12/2026')
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
})

describe('counting texts', () => {
  it('counts with the singular and puts the dative after "von"', () => {
    const entries: [string, string, string] = ['Eintrag', 'Einträge', 'Einträgen']
    expect(countText(1, 1, false, entries)).toBe('1 Eintrag')
    expect(countText(248, 248, false, entries)).toBe('248 Einträge')
    expect(countText(12, 1300, true, entries)).toBe('12 von 1.300 Einträgen')
  })
})

describe('isReadableTags', () => {
  it('accepts what the server reads: numbers, ranges, lists, "all", blanks and zeros around', () => {
    for (const text of [
      '104',
      ' 104 ',
      '0104',
      '100-130',
      '100 - 130',
      '1-10,15,20-25',
      '1999',
      'all',
    ])
      expect({ text, ok: isReadableTags(text) }).toEqual({ text, ok: true })
  })

  it('refuses what is incomplete or out of range', () => {
    for (const text of ['', '100-', '-5', 'abc', '0', '2000', '130-100', '1,,2', '1-10,', '10 5'])
      expect({ text, ok: isReadableTags(text) }).toEqual({ text, ok: false })
  })
})
