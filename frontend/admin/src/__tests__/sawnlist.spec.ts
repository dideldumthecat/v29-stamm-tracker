import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot, TimberItem } from '@v29/shared/contract'

import { applyFilters, matchesFilter, tagFilter } from '@/listFilters'
import { buildColumns, buildRows, filtersFor, sortRows, type Row } from '@/stemlist'
import { snapshotFixture } from './fakeSnapshot'

// The list Schnittholz: the rows (beams and stems sawn whole), their effective values, the order by tag.
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-09T12:00:00Z') }))
afterEach(() => vi.useRealTimers())

const { attributes } = snapshotFixture
const attribute = (name: string) => attributes.find((candidate) => candidate.name === name)!
const stem104 = snapshotFixture.timber_items.find((item) => item.tag_number === '104')!

let counter = 0
const item = (tag: string | null, values: TimberItem['values'] = {}, parent?: TimberItem) =>
  ({
    id: `x-${++counter}`,
    parent_id: parent?.id ?? null,
    tag_number: tag,
    has_children: false,
    created_at: '2026-10-20T08:00:00.000Z',
    created_by: stem104.created_by,
    values,
  }) satisfies TimberItem
const record = (value: boolean | string | number, recorded_at: string) => ({
  value,
  recorded_at,
  user_id: stem104.created_by,
  event_id: `r-${++counter}`,
})
const sawn = (value: boolean) => ({
  [attribute('Gesägt').id]: [record(value, '2026-10-21T08:00:00.000Z')],
})

const snapshotOf = (...extra: TimberItem[]): Snapshot => ({
  ...snapshotFixture,
  timber_items: [...snapshotFixture.timber_items, ...extra],
})
const listOf = (snapshot: Snapshot) => buildRows(snapshot, 'beam')
const tagsOf = (rows: Row[]) => rows.map((row) => row.item.tag_number)

describe('Schnittholz rows', () => {
  it('are the beams and the stems sawn whole, not split stems, not stems that are not sawn', () => {
    const whole = item('200', sawn(true))
    const notSawn = item('201', sawn(false))
    const neverRecorded = item('202')
    const rows = listOf(snapshotOf(whole, notSawn, neverRecorded))

    // 104 is split (has beams, "Gesägt: ja"), 7 and 1500 are not sawn, the stem without tag has no "Gesägt"
    expect(tagsOf(rows)).toEqual(['104-A', '104-B', '104-C', '200'])
  })

  it('leave out a stem that says "Gesägt: ja" but has beams, and take a beam without tag', () => {
    const rows = listOf(snapshotOf(item(null, {}, stem104)))
    expect(tagsOf(rows)).toEqual(['104-A', '104-B', '104-C', null])
  })

  it('find the whole-sawn stem by the key of the attribute, not by its name', () => {
    const renamed = {
      ...snapshotOf(item('200', sawn(true))),
      attributes: attributes.map((candidate) =>
        candidate.key === 'sawn' ? { ...candidate, name: 'Fertig geschnitten' } : candidate,
      ),
    }
    expect(tagsOf(listOf(renamed))).toContain('200')
    // without the key there is no way to tell: only beams
    const keyless = {
      ...renamed,
      attributes: attributes.map((candidate) => ({ ...candidate, key: null })),
    }
    expect(tagsOf(listOf(keyless))).toEqual(['104-A', '104-B', '104-C'])
  })

  it('are the beams of the beam attributes, with "Balken" first and "Geändert" last, no count of beams', () => {
    const labels = buildColumns(attributes, 'beam').map((column) => column.label)
    expect(labels).toEqual([
      'Balken',
      'Lieferdatum',
      'Sortierklasse',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
      'Geändert',
    ])
  })
})

describe('Schnittholz values', () => {
  const columns = buildColumns(attributes, 'beam')
  const column = (name: string) => columns.find((candidate) => candidate.label === name)!

  // A beam with the stem's values, as the snapshot delivers them: the same recordings (event ids) as the stem
  const stemValues = {
    [attribute('Holzfeuchte').id]: [record(44, '2026-10-22T08:00:00.000Z')],
    [attribute('Lieferdatum').id]: [record('2026-10-01', '2026-10-22T08:01:00.000Z')],
    [attribute('Notiz').id]: [record('Vom Stamm', '2026-10-22T08:02:00.000Z')],
  }
  const parent = item('300', stemValues)
  const own = item(
    '300-A',
    {
      ...stemValues,
      [attribute('Holzfeuchte').id]: [record(30, '2026-10-25T08:00:00.000Z')],
    },
    parent,
  )
  const onlyInherited = item('300-B', stemValues, parent)
  const rows = buildRows(snapshotOf(parent, own, onlyInherited), 'beam', columns).filter((row) =>
    row.item.tag_number?.startsWith('300'),
  )
  const row = (tag: string) => rows.find((candidate) => candidate.item.tag_number === tag)!
  const text = (tag: string, name: string) => row(tag).cells[column(name).id].text

  it("show the effective values: the beam's own, otherwise the one it inherits", () => {
    expect(text('300-A', 'Holzfeuchte')).toBe('30 %')
    expect(text('300-B', 'Holzfeuchte')).toBe('44 %')
    expect(text('300-B', 'Lieferdatum')).toBe('01.10.2026')
  })

  it('sort and filter by the same values', () => {
    const feuchte = column('Holzfeuchte')
    expect(tagsOf(sortRows(rows, feuchte, 'asc'))).toEqual(['300-A', '300-B'])
    const range = { kind: 'range', from: '40', to: '50' } as const
    expect(rows.filter((candidate) => matchesFilter(candidate, feuchte, range))).toEqual([
      row('300-B'),
    ])
    const delivered = { kind: 'range', from: '2026-09-01', to: '2026-10-31' } as const
    expect(
      rows.filter((candidate) => matchesFilter(candidate, column('Lieferdatum'), delivered)),
    ).toHaveLength(2)
  })

  it('hide a note that is only inherited, show an own one, and do not find the hidden one', () => {
    const noteColumn = column('Notiz')
    const ownNote = item(
      '300-C',
      {
        ...stemValues,
        [attribute('Notiz').id]: [record('Eigene', '2026-10-26T08:00:00.000Z')],
      },
      parent,
    )
    const withOwn = buildRows(snapshotOf(parent, ownNote), 'beam', columns).find(
      (candidate) => candidate.item.tag_number === '300-C',
    )!

    expect(text('300-B', 'Notiz')).toBeNull()
    expect(withOwn.cells[noteColumn.id].text).toBe('Eigene')

    const contains = { kind: 'contains', text: 'Stamm' } as const
    expect(matchesFilter(row('300-B'), noteColumn, contains)).toBe(false)
    expect(matchesFilter(row('300-B'), noteColumn, { kind: 'none' })).toBe(true)
    // the stem itself has its note
    const stemRow = buildRows(snapshotOf(parent), 'stem').find(
      (candidate) => candidate.item.tag_number === '300',
    )!
    const stemNote = buildColumns(attributes, 'stem').find(
      (candidate) => candidate.label === 'Notiz',
    )!
    expect(stemRow.cells[stemNote.id].text).toBe('Vom Stamm')
  })

  it('has "Geändert" of a beam with only inherited values from its creation, not from the stem\'s recordings', () => {
    const changed = row('300-B').cells.changed
    expect(changed.text).toBe('20.10.')
    // the beam with an own value: its latest own recording
    expect(row('300-A').cells.changed.text).toBe('25.10.')
    expect(row('300-B').changedBy).toBe(
      snapshotFixture.users.find((u) => u.id === stem104.created_by)!.name,
    )
  })
})

describe('sorting by tag', () => {
  const columns = buildColumns(attributes, 'beam')
  const tagColumn = columns[0]
  // Not in tag order, so that the order comes from the sort
  const rows = listOf(
    snapshotOf(item('105', sawn(true)), item('99', sawn(true)), item(null, {}, stem104)),
  )
  const reversed = [...rows].reverse()

  it('goes by the number, then by the letter, and puts items without a tag last', () => {
    expect(tagsOf(sortRows(reversed, tagColumn, 'asc'))).toEqual([
      '99',
      '104-A',
      '104-B',
      '104-C',
      '105',
      null,
    ])
  })

  it('reverses number and letter, and keeps items without a tag last', () => {
    expect(tagsOf(sortRows(rows, tagColumn, 'desc'))).toEqual([
      '105',
      '104-C',
      '104-B',
      '104-A',
      '99',
      null,
    ])
  })

  it('also orders the stems of Rundholz with a plain number', () => {
    const stems = buildRows(snapshotFixture, 'stem')
    const column = buildColumns(attributes, 'stem')[0]
    expect(tagsOf(sortRows([...stems].reverse(), column, 'asc'))).toEqual([
      '7',
      '104',
      '1500',
      null,
    ])
  })

  it('is what a tie in another column falls back to', () => {
    const feuchte = columns.find((candidate) => candidate.label === 'Holzfeuchte')!
    expect(tagsOf(sortRows(reversed, feuchte, 'desc'))).toEqual([
      '99',
      '104-A',
      '104-B',
      '104-C',
      '105',
      null,
    ])
  })
})

describe('Schnittholz "Kennung" filter', () => {
  const rows = listOf(
    snapshotOf(item('104-D', {}, stem104), item('105', sawn(true)), item('2', sawn(true))),
  )
  const found = (text: string) => tagsOf(applyFilters(rows, [tagFilter(text)!]))

  it('finds all beams of a stem', () => {
    expect(found('104')).toEqual(['104-A', '104-B', '104-C', '104-D'])
  })

  it('finds a stem sawn whole by its number', () => {
    expect(found('105')).toEqual(['105'])
    expect(found('100-110')).toEqual(['104-A', '104-B', '104-C', '104-D', '105'])
  })

  it('finds exactly one beam by its tag, however it is written', () => {
    expect(found('104-A')).toEqual(['104-A'])
    expect(found('104b')).toEqual(['104-B'])
    expect(found('0104-c')).toEqual(['104-C'])
    expect(found('104-E')).toEqual([])
  })

  it('is part of the filters of a URL', () => {
    const columns = buildColumns(attributes, 'beam')
    const filters = filtersFor({ tags: '104-A', filters: {}, sort: 'tag', dir: 'asc' }, columns)!
    expect(tagsOf(applyFilters(rows, filters))).toEqual(['104-A'])
  })
})
