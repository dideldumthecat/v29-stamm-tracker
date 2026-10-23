import { describe, it, expect } from 'vitest'
import type { Attribute, AttributeType, AttributeValueRecord } from '@/api/contract'
import { collectDraft, parseNumber } from '@/utils/attributeDraft'
import { parseDate } from '@/utils/date'

function attribute(id: string, type: AttributeType, overrides: Partial<Attribute> = {}): Attribute {
  return {
    id,
    name: id,
    description: '',
    type,
    unit: null,
    is_series: false,
    is_inheritable: false,
    sort_order: 0,
    active: true,
    options: [],
    ...overrides,
  }
}

function record(value: AttributeValueRecord['value']): AttributeValueRecord[] {
  return [{ value, recorded_at: '2026-10-02T07:12:00Z', user_id: 'u', event_id: 'e' }]
}

describe('parseDate', () => {
  it('accepts TT.MM.JJJJ and one-digit day and month', () => {
    expect(parseDate('28.09.2026')).toBe('2026-09-28')
    expect(parseDate(' 8.9.2026 ')).toBe('2026-09-08')
  })

  it('rejects half-typed, wrongly formatted and impossible dates', () => {
    const texts = ['', '28.09.', '28.09.26', '2026-09-28', '31.02.2026', '00.01.2026']
    expect(texts.map(parseDate)).toEqual(texts.map(() => null))
  })
})

describe('parseNumber', () => {
  it('accepts comma and dot as decimal separator', () => {
    expect(parseNumber('34,5')).toBe(34.5)
    expect(parseNumber('34.5')).toBe(34.5)
    expect(parseNumber(' 41 ')).toBe(41)
  })

  it('rejects anything that is not entirely a number', () => {
    const texts = ['', 'abc', '34abc', '34,', '1,2,3']
    expect(texts.map(parseNumber)).toEqual(texts.map(() => null))
  })
})

describe('collectDraft', () => {
  const choice = attribute('choice', 'choice')
  const flag = attribute('flag', 'boolean')
  const date = attribute('date', 'date')
  const number = attribute('number', 'number')
  const note = attribute('note', 'text')
  const series = attribute('series', 'number', { is_series: true })
  const all = [choice, flag, date, number, note, series]

  it('ignores untouched, empty and unchanged input', () => {
    const result = collectDraft(
      all,
      { choice: '', date: '  ', note: ' ', flag: false, number: '5' },
      {},
      { number: record(5) },
    )
    expect(result).toEqual({ changes: [], errors: {} })
  })

  it('collects values in contract format', () => {
    const { changes, errors } = collectDraft(
      all,
      { choice: 'opt-1', flag: true, date: '8.9.2026', number: '34,5', note: ' hi ' },
      {},
      undefined,
    )
    expect(errors).toEqual({})
    expect(changes).toEqual([
      { attributeId: 'choice', value: 'opt-1' },
      { attributeId: 'flag', value: true },
      { attributeId: 'date', value: '2026-09-08' },
      { attributeId: 'number', value: 34.5 },
      { attributeId: 'note', value: 'hi' },
    ])
  })

  it('records changes to a recorded value, including true → false', () => {
    const { changes } = collectDraft(
      [flag, number],
      { flag: false, number: '6' },
      {},
      { flag: record(true), number: record(5) },
    )
    expect(changes).toEqual([
      { attributeId: 'flag', value: false },
      { attributeId: 'number', value: 6 },
    ])
  })

  it('reports invalid input as error without a change', () => {
    const { changes, errors } = collectDraft(
      all,
      { date: '28.09.', number: '34abc' },
      {},
      undefined,
    )
    expect(changes).toEqual([])
    expect(Object.keys(errors)).toEqual(['date', 'number'])
  })

  it('adds the pending series input after the values already added', () => {
    const { changes } = collectDraft(
      [series],
      { series: '40' },
      { series: [38, 39] },
      {
        series: record(48.5),
      },
    )
    expect(changes.map((change) => change.value)).toEqual([38, 39, 40])
  })

  it('records a pending series input even if it equals the last value', () => {
    const { changes } = collectDraft([series], { series: '41' }, {}, { series: record(41) })
    expect(changes).toEqual([{ attributeId: 'series', value: 41 }])
  })

  it('keeps added series values when the pending input is invalid', () => {
    const { changes, errors } = collectDraft([series], { series: 'x' }, { series: [38] }, undefined)
    expect(changes).toEqual([{ attributeId: 'series', value: 38 }])
    expect(errors).toHaveProperty('series')
  })
})
