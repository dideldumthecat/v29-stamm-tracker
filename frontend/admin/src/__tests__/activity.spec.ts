import { describe, expect, it } from 'vitest'
import type { ActivityEntry, ActivityItem } from '@v29/shared/contract'

import {
  completeDays,
  detailRows,
  formatRecordedTime,
  groupByDay,
  isReadableTags,
  summarize,
} from '@/activity'
import { activityFixture } from './fakeActivity'

const entryOf = (name: string) => activityFixture.entries.find((entry) => entry.user.name === name)!
const item = (label: string, changes: [string, string, string][]) =>
  ({
    label,
    changes: changes.map(([kind, name, value]) => ({
      kind,
      name,
      value,
      text: '',
      recorded_at: '',
    })),
  }) as unknown as ActivityItem
const entryWith = (...items: ActivityItem[]) => ({ items }) as ActivityEntry

describe('summarize', () => {
  it('counts what was created, per attribute the distinct stems and beams, and photos, in this order', () => {
    expect(summarize(entryOf('Alexander Barina'))).toEqual([
      '3 Balken angelegt',
      'Gesägt – 1 Stamm',
      'Notiz – 1 Balken',
      '3 Fotos',
    ])
    expect(summarize(entryOf('Sägewerk Eulitz GbR'))).toEqual([
      '2 Balken angelegt',
      'Gesägt – 9 Stämme',
      'Notiz – 1 Stamm',
      '1 Foto',
    ])
  })

  it('lists attributes in the order of their first appearance, without tags', () => {
    expect(summarize(entryOf('Alexander Summa'))).toEqual([
      'Länge – 1 Stamm',
      'Stammmittendurchmesser groß – 1 Stamm',
      'Fälldatum – 1 Stamm',
    ])
  })

  it('sums up photos and voidings', () => {
    expect(summarize(entryOf('Florian Summa'))).toEqual(['2 Fotos'])
    const voided = activityFixture.entries.find((entry) => entry.items[0].label === '1998')!
    expect(summarize(voided)).toEqual(['2 Stämme storniert'])
  })

  it('counts a value of one stem once, and stems and beams apart', () => {
    const entry = entryWith(
      item('7', [
        ['value', 'Gesägt', 'ja'],
        ['value', 'Gesägt', 'nein'],
      ]),
      item('7-A', [['value', 'Gesägt', 'ja']]),
      item('8', [['value', 'Gesägt', 'ja']]),
    )
    expect(summarize(entry)).toEqual(['Gesägt – 2 Stämme, 1 Balken'])
  })

  it('names new stems and beams, ignores the tag of a new item and counts a tag change on its own', () => {
    const entry = entryWith(
      item('7', [
        ['created', 'Stamm', 'angelegt'],
        ['tag', 'Kennung', '7'],
      ]),
      item('7-A', [
        ['created', 'Balken', 'angelegt'],
        ['tag', 'Kennung', '7-A'],
      ]),
      item('8', [['tag', 'Kennung', '8']]),
    )
    expect(summarize(entry)).toEqual([
      '1 Stamm angelegt',
      '1 Balken angelegt',
      '1 Kennung geändert',
    ])
  })

  it('counts voidings and restorations per name: whole stems and beams short, attributes with their stems and beams', () => {
    const entry = entryWith(
      item('9', [
        ['voided', 'Stamm', 'storniert'],
        ['voided', 'Entrindet', 'storniert'],
        ['restored', 'Stamm', 'wiederhergestellt'],
      ]),
      item('10', [['voided', 'Stamm', 'storniert']]),
      item('10-A', [
        ['voided', 'Balken', 'storniert'],
        ['voided', 'Entrindet', 'storniert'],
        ['voided', 'Fotos', 'storniert'],
        ['restored', 'Entrindet', 'wiederhergestellt'],
      ]),
      item('11', [['voided', 'Entrindet', 'storniert']]),
    )
    expect(summarize(entry)).toEqual([
      '2 Stämme storniert',
      'Entrindet storniert – 2 Stämme, 1 Balken',
      '1 Balken storniert',
      'Fotos storniert – 1 Balken',
      '1 Stamm wiederhergestellt',
      'Entrindet wiederhergestellt – 1 Balken',
    ])
  })
})

describe('detailRows', () => {
  it('shows name and value as sent, set values one row each and the tag of a new item not at all', () => {
    expect(
      detailRows(
        item('104-C', [
          ['created', 'Balken', 'angelegt'],
          ['tag', 'Kennung', '104-C'],
          ['value', 'Notiz', 'Länge: 4 m'],
          ['value', 'Notiz', 'Länge: 4 m'],
        ]),
      ),
    ).toEqual([
      { name: 'Balken', value: 'angelegt' },
      { name: 'Notiz', value: 'Länge: 4 m' },
      { name: 'Notiz', value: 'Länge: 4 m' },
    ])
  })

  it('merges equal rows at the first one and counts them; photos always carry their count', () => {
    expect(
      detailRows(
        item('128', [
          ['photo', 'Fotos', 'hinzugefügt'],
          ['tag', 'Kennung', '129'],
          ['photo', 'Fotos', 'hinzugefügt'],
          ['voided', 'Gesägt', 'storniert'],
          ['voided', 'Fotos', 'storniert'],
          ['voided', 'Gesägt', 'storniert'],
          ['voided', 'Gesägt', 'wiederhergestellt'],
        ]),
      ),
    ).toEqual([
      { name: 'Fotos', value: '2 hinzugefügt' },
      { name: 'Kennung', value: '129' },
      { name: 'Gesägt', value: '2 storniert' },
      { name: 'Fotos', value: 'storniert' },
      { name: 'Gesägt', value: 'wiederhergestellt' },
    ])
    expect(detailRows(item('1', [['photo', 'Fotos', 'hinzugefügt']]))).toEqual([
      { name: 'Fotos', value: '1 hinzugefügt' },
    ])
  })
})

describe('days and times', () => {
  it('groups by German day and writes the heading as in the design', () => {
    const days = groupByDay(activityFixture.entries)
    expect(days.map((day) => [day.heading, day.entries.length])).toEqual([
      ['Di, 03.11.2026', 1],
      ['Sa, 31.10.2026', 5],
    ])
  })

  it('counts a day by German time: 23:30 UTC is already the next day', () => {
    const entry = { ...activityFixture.entries[0], received_at: '2026-10-31T23:30:00.000Z' }
    expect(groupByDay([entry])[0].heading).toBe('So, 01.11.2026')
  })
})

describe('completeDays', () => {
  const days = groupByDay(activityFixture.entries)

  it('shows all days when the server has no more entries, the oldest one included', () => {
    expect(completeDays(days, false).map((day) => day.key)).toEqual(['2026-11-03', '2026-10-31'])
  })

  it('holds back the oldest loaded day while the server has more: it may continue on the next page', () => {
    expect(completeDays(days, true).map((day) => day.key)).toEqual(['2026-11-03'])
  })

  it('shows nothing when only one day is loaded and more is to come, and nothing for nothing', () => {
    expect(completeDays(days.slice(0, 1), true)).toEqual([])
    expect(completeDays([], true)).toEqual([])
    expect(completeDays([], false)).toEqual([])
  })
})

describe('recorded times against the arrival day', () => {
  const received = '2026-11-08T10:30:00.000Z' // 08.11. 11:30 in Berlin

  it('shows no date on the arrival day', () => {
    expect(formatRecordedTime('2026-11-08T10:46:00Z', received)).toBe('11:46')
  })

  it('shows the date (TT.MM.) on any other day', () => {
    // the production case of 8 Nov 2026: recorded 4 Nov 18:02 to 5 Nov 18:00
    expect(formatRecordedTime('2026-11-04T17:02:00Z', received)).toBe('04.11. 18:02')
    expect(formatRecordedTime('2026-11-05T17:00:00Z', received)).toBe('05.11. 18:00')
  })

  it('compares the days in German time, not in UTC', () => {
    // 23:10 UTC on the 7th is 00:10 on the 8th in Berlin: the arrival day
    expect(formatRecordedTime('2026-11-07T23:10:00Z', received)).toBe('00:10')
    // arrival 23:30 UTC on the 7th is the 8th in Berlin; 22:30 UTC on the 7th is still the 7th there
    expect(formatRecordedTime('2026-11-07T22:30:00Z', '2026-11-07T23:30:00.000Z')).toBe(
      '07.11. 23:30',
    )
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
