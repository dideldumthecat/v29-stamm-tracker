import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityChange, ActivityEntry } from '@v29/shared/contract'

import {
  beamsOf,
  historyPoints,
  normalizeTag,
  photoFileName,
  plaqueTag,
  splitValues,
  timelineRows,
  type HistoryPoint,
} from '@/detail'
import { activityFixture } from './fakeActivity'
import { snapshotFixture, stemPhotos } from './fakeSnapshot'

const { timber_items: items, attributes, users } = snapshotFixture
const stem = items.find((item) => item.tag_number === '104')!
const beamC = items.find((item) => item.tag_number === '104-C')!

// The origin dates show the year only outside the current one, so the clock is pinned.
const today = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) })
beforeEach(() => today('2026-11-09T12:00:00Z'))
afterEach(() => vi.useRealTimers())
describe('normalizeTag', () => {
  it('ignores leading zeros and the case of the letter', () => {
    expect(normalizeTag('104')).toBe('104')
    expect(normalizeTag('00104')).toBe('104')
    expect(normalizeTag('104-c')).toBe('104-C')
    expect(normalizeTag('0104-C')).toBe('104-C')
  })

  it('refuses anything that is no tag of the plaque range', () => {
    for (const text of ['', '0', '00000', '2000', 'abc', '104-', '104-CD', '104-1', '-A', '1 04'])
      expect(normalizeTag(text)).toBeNull()
  })
})

describe('file names', () => {
  it('write the tag as on the plaque and count the photos from 1', () => {
    expect(plaqueTag('104')).toBe('00104')
    expect(photoFileName('104', 1)).toBe('00104-1.jpg')
    expect(photoFileName('104-C', 2)).toBe('00104-C-2.jpg')
  })
})

describe('splitValues', () => {
  const parts = splitValues(stem, undefined, attributes, users)

  it('takes the photos by attribute type, oldest first', () => {
    expect(parts.photos.map((photo) => photo.id)).toEqual(stemPhotos)
    expect(parts.photos.map((photo) => photo.recorded_at)).toEqual([
      '2026-10-29T10:14:00.000Z',
      '2026-10-30T23:30:00.000Z',
    ])
  })

  it('lists the attributes in V29 order, without photos and text series, an inactive one only with a value', () => {
    expect(parts.rows.map((row) => row.name)).toEqual([
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Lagerplatz',
      'Gesägt',
      'Sortierklasse',
      'Holzfeuchte',
    ])
  })

  it('writes values with who and when, booleans as ja/nein, a series newest first, nothing recorded as empty', () => {
    const row = (name: string) => parts.rows.find((candidate) => candidate.name === name)!
    expect(row('Holzart').lines).toEqual([
      { text: 'Stieleiche', source: 'Alexander Summa · 29.10.' },
    ])
    expect(row('Fälldatum').lines[0].text).toBe('10/2026')
    expect(row('Gesägt').lines).toEqual([{ text: 'ja', source: 'Alexander Barina · 31.10.' }])
    expect(row('Holzfeuchte').lines.map((line) => line.text)).toEqual(['41 %', '48,5 %'])
    expect(row('Lieferdatum').lines).toEqual([])

    const unsawn = structuredClone(stem)
    unsawn.values[attributes.find((a) => a.name === 'Gesägt')!.id][0].value = false
    const rows = splitValues(unsawn, undefined, attributes, users).rows
    expect(rows.find((candidate) => candidate.name === 'Gesägt')!.lines[0].text).toBe('nein')
  })

  it('collects the text series as notes, newest first, and the latest own time', () => {
    expect(parts.notes).toEqual([
      {
        name: 'Notiz',
        entries: [
          { text: 'Zweite Zeile\nmit Umbruch', source: 'Alexander Barina · 31.10.' },
          { text: 'Leichter Drehwuchs', source: 'Alexander Summa · 29.10.' },
        ],
      },
    ])
    expect(parts.lastChanged).toBe('2026-10-31T10:50:00.000Z')
  })

  it('marks what a beam inherits and leaves it out of photos, notes and the last change', () => {
    const beam = splitValues(beamC, stem, attributes, users)
    const row = (name: string) => beam.rows.find((candidate) => candidate.name === name)!
    expect(row('Holzart').lines).toEqual([{ text: 'Stieleiche', source: 'vom Stamm geerbt' }])
    expect(row('Gesägt').lines[0].source).toBe('vom Stamm geerbt')
    expect(row('Sortierklasse').lines[0]).toEqual({
      text: 'B',
      source: 'Alexander Barina · 31.10.',
    })
    expect(beam.notes[0].entries).toEqual([
      { text: '105x145', source: 'Alexander Barina · 31.10.' },
    ])
    expect(beam.photos).toEqual([])
    expect(beam.lastChanged).toBe('2026-10-31T10:47:50.000Z')
  })

  it('has no last change without own values', () => {
    expect(
      splitValues(
        items.find((i) => i.tag_number === '104-B')!,
        stem,
        attributes,
        users,
      ).lastChanged,
    ).toBeUndefined()
  })
})

describe('beamsOf', () => {
  it('returns the beams of a stem in tag order', () => {
    expect(beamsOf(stem, [...items].reverse()).map((beam) => beam.tag_number)).toEqual([
      '104-A',
      '104-B',
      '104-C',
    ])
  })
})

describe('historyPoints', () => {
  const ids = (labels: string[]) =>
    new Set(items.filter((item) => labels.includes(item.tag_number!)).map((item) => item.id))
  const stemId = stem.id

  const change = (at: string, value = 'ja'): ActivityChange => ({
    kind: 'value',
    name: 'Gesägt',
    value,
    recorded_at: `2026-10-31T${at}.000Z`,
  })
  const photo = (at: string): ActivityChange => ({
    kind: 'photo',
    name: 'Fotos',
    value: 'hinzugefügt',
    recorded_at: `2026-10-31T${at}.000Z`,
  })
  /** An entry as the server sends it: one person, the items with their changes. */
  const entry = (
    user: string,
    receivedAt: string,
    parts: Record<string, ActivityChange[]>,
  ): ActivityEntry => ({
    id: `${user}-${receivedAt}`,
    received_at: receivedAt,
    user: { id: user, name: user },
    recorded_from: receivedAt,
    recorded_to: receivedAt,
    event_count: 1,
    items: Object.entries(parts).map(([id, changes]) => ({
      timber_item_id: id,
      label: id,
      changes,
    })),
  })
  const arrived = '2026-10-31T12:00:00.000Z'
  const points = (entries: ActivityEntry[], of = ['a', 'b', 'c']) =>
    historyPoints(entries, new Set(of), 'a')

  it('groups the fixture of 31 October into one point: one save with its beams', () => {
    const result = historyPoints(
      activityFixture.entries,
      ids(['104', '104-A', '104-B', '104-C']),
      stemId,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      user: 'Alexander Barina',
      recordedAt: '2026-10-31T10:46:00.000Z',
      transferredAt: null,
    })
    expect(result[0].items.map((item) => item.label)).toEqual(['104', '104-A', '104-B', '104-C'])
  })

  it('starts a new point when the person changes or the gap is more than two minutes', () => {
    const result = points([
      entry('Anna', arrived, { a: [change('10:00:00'), change('10:02:00')] }),
      entry('Ben', arrived, { a: [change('10:02:30')] }),
      entry('Anna', arrived, { a: [change('10:04:31')] }),
    ])
    // Anna 10:00 + 10:02 (exactly two minutes), Ben 10:02:30, Anna 10:04:31 (not after Ben's, but a new person again)
    expect(result.map((point) => [point.user, point.recordedAt.slice(11, 19)])).toEqual([
      ['Anna', '10:04:31'],
      ['Ben', '10:02:30'],
      ['Anna', '10:00:00'],
    ])
    expect(result[2].items[0].changes).toHaveLength(2)
  })

  it('chains the gaps: a point may last longer than two minutes as long as no gap is larger', () => {
    const result = points([
      entry('Anna', arrived, { a: [change('10:00:00'), change('10:01:50'), change('10:03:40')] }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].recordedAt).toBe('2026-10-31T10:00:00.000Z')
  })

  it('puts photos that arrive shortly after the save into its point, later ones into their own', () => {
    const result = points([
      entry('Anna', arrived, { a: [change('10:00:00')] }),
      entry('Anna', '2026-10-31T12:30:00.000Z', { a: [photo('10:01:30'), photo('10:09:00')] }),
    ])
    expect(result.map((point) => point.items[0].changes.map((c) => c.kind))).toEqual([
      ['photo'],
      ['value', 'photo'],
    ])
  })

  it('sorts by device time over entries, not by arrival', () => {
    const result = points([
      entry('Ben', '2026-10-31T13:00:00.000Z', { a: [change('11:00:00')] }),
      entry('Anna', '2026-10-31T12:00:00.000Z', { a: [change('10:00:00')] }),
    ])
    expect(result.map((point) => point.user)).toEqual(['Ben', 'Anna'])
  })

  const created = (at: string): ActivityChange => ({
    kind: 'created',
    name: 'Balken',
    value: 'angelegt',
    recorded_at: `2026-10-31T${at}.000Z`,
  })

  it('shows the shown item first, then beams by tag, of the beams only their creation', () => {
    const result = points([
      entry('Anna', arrived, {
        c: [created('10:00:10'), change('10:00:15')],
        b: [created('10:00:20'), change('10:00:30', 'nein')],
        a: [change('10:00:40')],
      }),
    ])
    expect(result[0].items.map((item) => item.label)).toEqual(['a', 'b', 'c'])
    expect(result[0].items.map((item) => item.changes.map((c) => c.kind))).toEqual([
      ['value'],
      ['created'],
      ['created'],
    ])
  })

  it('drops the other changes of beams before grouping: points that only had those vanish, gaps count without them', () => {
    const result = points([
      entry('Anna', arrived, {
        a: [change('10:00:00'), change('10:03:00')],
        // would bridge the gap between the two stem changes and form a point of its own at 10:20
        b: [change('10:01:30'), photo('10:20:00')],
      }),
      entry('Ben', arrived, { c: [change('10:10:00'), photo('10:10:30')] }),
    ])
    expect(result.map((point) => [point.user, point.recordedAt.slice(11, 19)])).toEqual([
      ['Anna', '10:03:00'],
      ['Anna', '10:00:00'],
    ])
  })

  it('keeps all changes of a beam when it is the shown item', () => {
    const result = historyPoints(
      [entry('Anna', arrived, { b: [created('10:00:00'), change('10:00:30'), photo('10:01:00')] })],
      new Set(['b']),
      'b',
    )
    expect(result).toHaveLength(1)
    expect(result[0].items[0].changes.map((c) => c.kind)).toEqual(['created', 'value', 'photo'])
  })

  it('leaves out items that are not asked for', () => {
    const result = points([
      entry('Anna', arrived, { a: [change('10:00:00')], x: [change('10:00:10')] }),
    ])
    expect(result[0].items.map((item) => item.label)).toEqual(['a'])
    expect(points([entry('Anna', arrived, { x: [change('10:00:00')] })])).toEqual([])
  })

  describe('transferredAt', () => {
    it('is the latest arrival if that is on another German day than the point', () => {
      const result = points([
        entry('Anna', '2026-11-01T08:00:00.000Z', { a: [change('10:00:00')] }),
        entry('Anna', '2026-11-02T08:00:00.000Z', { b: [created('10:00:30')] }),
      ])
      expect(result[0].transferredAt).toBe('2026-11-02T08:00:00.000Z')
    })

    it('is missing on the same day, counted in German time', () => {
      // 22:30 UTC on the 31st is 23:30 in Berlin; 23:30 UTC is already 00:30 on the 1st
      const sameBerlinDay = points([
        entry('Anna', '2026-10-31T22:30:00.000Z', { a: [change('10:00:00')] }),
      ])
      expect(sameBerlinDay[0].transferredAt).toBeNull()
      const nextBerlinDay = points([
        entry('Anna', '2026-10-31T23:30:00.000Z', { a: [change('10:00:00')] }),
      ])
      expect(nextBerlinDay[0].transferredAt).toBe('2026-10-31T23:30:00.000Z')
    })
  })
})

describe('origin date of a value', () => {
  it('has no year in the current year', () => {
    const { rows } = splitValues(stem, undefined, attributes, users)
    expect(rows.find((row) => row.name === 'Holzart')!.lines[0].source).toBe(
      'Alexander Summa · 29.10.',
    )
  })

  it('has the year in two digits in another year', () => {
    today('2027-01-05T12:00:00Z')
    const { rows } = splitValues(stem, undefined, attributes, users)
    expect(rows.find((row) => row.name === 'Holzart')!.lines[0].source).toBe(
      'Alexander Summa · 29.10.26',
    )
  })
})

describe('timelineRows', () => {
  const point = (recordedAt: string) => ({ key: recordedAt, recordedAt }) as HistoryPoint
  const marks = (rows: ReturnType<typeof timelineRows>) =>
    rows.map((row) => row.year ?? row.point!.recordedAt.slice(0, 10))
  const newYear = [
    point('2026-01-03T10:00:00Z'),
    point('2025-12-30T10:00:00Z'),
    point('2025-12-29T10:00:00Z'),
  ]

  it('has no year marks if all points are in the current year', () => {
    expect(marks(timelineRows(newYear.slice(0, 1), 2026))).toEqual(['2026-01-03'])
  })

  it('marks every year, also the current one, if the points span a new year', () => {
    expect(marks(timelineRows(newYear, 2026))).toEqual([
      2026,
      '2026-01-03',
      2025,
      '2025-12-30',
      '2025-12-29',
    ])
  })

  it('marks the year if all points are in the previous year', () => {
    expect(marks(timelineRows(newYear.slice(1), 2026))).toEqual([2025, '2025-12-30', '2025-12-29'])
  })

  it('has no rows without points', () => {
    expect(timelineRows([], 2026)).toEqual([])
  })
})
