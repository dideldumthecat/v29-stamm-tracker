import { describe, expect, it } from 'vitest'

import { coordinateHint, draftOf, emptyDraft, fieldsOf, formatVolume, mapUrl } from '@/piles'

describe('fieldsOf', () => {
  it('turns the draft into the request, an empty field into null (the number stays text, the server asks for it)', () => {
    expect(fieldsOf(emptyDraft())).toEqual({
      fields: {
        number: '',
        location: null,
        latitude: null,
        longitude: null,
        stacked_volume: null,
      },
    })
    expect(
      fieldsOf({
        number: ' 2601-010145 ',
        location: 'Krummes F',
        latitude: `51°24'47"`,
        longitude: '13,060556',
        stackedVolume: '51,52',
      }),
    ).toEqual({
      fields: {
        number: '2601-010145',
        location: 'Krummes F',
        latitude: 51.413056,
        longitude: 13.060556,
        stacked_volume: 51.52,
      },
    })
  })

  it('names every field it cannot read', () => {
    const answer = fieldsOf({
      ...emptyDraft(),
      latitude: 'x',
      longitude: '13°',
      stackedVolume: '5 m',
    })
    expect(answer).toHaveProperty('errors')
    expect(Object.keys((answer as { errors: object }).errors)).toEqual([
      'latitude',
      'stacked_volume',
    ])
  })

  it('shows a saved pile as it is typed in German', () => {
    const draft = draftOf({
      id: 'a',
      label: 'x',
      number: null,
      location: 'Am Bach',
      latitude: 51.413056,
      longitude: 13,
      stacked_volume: 8,
    })
    expect(draft).toEqual({
      number: '',
      location: 'Am Bach',
      latitude: '51,413056',
      longitude: '13',
      stackedVolume: '8',
    })
    expect(fieldsOf(draft)).toHaveProperty('fields.latitude', 51.413056)
  })
})

describe('display', () => {
  it('shows the decimal value of a coordinate once it can be read', () => {
    expect(coordinateHint(`51°24'47"`)).toBe('= 51,413056')
    expect(coordinateHint('13.5')).toBe('= 13,5')
    expect(coordinateHint('')).toBeNull()
    expect(coordinateHint('51°24')).toBeNull()
  })

  it('formats the volume in German with two decimals', () => {
    expect(formatVolume(51.52)).toBe('51,52 Rm')
    expect(formatVolume(8)).toBe('8,00 Rm')
    expect(formatVolume(1234.5)).toBe('1.234,50 Rm')
  })

  it('links to OpenStreetMap only with both coordinates', () => {
    expect(mapUrl({ latitude: 51.413056, longitude: 13.060556 })).toBe(
      'https://www.openstreetmap.org/?mlat=51.413056&mlon=13.060556#map=16/51.413056/13.060556',
    )
    expect(mapUrl({ latitude: null, longitude: null })).toBeNull()
  })
})
