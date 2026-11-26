import type { AdminPile } from '@/api/contract'

import { errorsOf } from '@/attributes'
import { parseCoordinate } from '@/coordinates'

/** What the form holds: the text as typed, numbers as German or decimal text. */
export interface PileDraft {
  number: string
  location: string
  latitude: string
  longitude: string
  stackedVolume: string
}

export const emptyDraft = (): PileDraft => ({
  number: '',
  location: '',
  latitude: '',
  longitude: '',
  stackedVolume: '',
})

const germanNumber = (value: number | null) =>
  value === null ? '' : String(value).replace('.', ',')

export const draftOf = (pile: AdminPile): PileDraft => ({
  number: pile.number ?? '',
  location: pile.location ?? '',
  latitude: germanNumber(pile.latitude),
  longitude: germanNumber(pile.longitude),
  stackedVolume: germanNumber(pile.stacked_volume),
})

export interface PileFields {
  /** Required: an empty one is sent as it is and the server answers 422 at the field. */
  number: string
  location: string | null
  latitude: number | null
  longitude: number | null
  stacked_volume: number | null
}

const COORDINATE_HINT = `Bitte als Dezimalgrad (51,4132) oder als Grad, Minuten, Sekunden (51°24'47") eingeben.`

/**
 * The body of the request for a draft, or the errors of what cannot be read (the rules of the values are the server's). An empty field is null.
 */
export function fieldsOf(
  draft: PileDraft,
): { fields: PileFields } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const read = (
    field: string,
    text: string,
    parse: (text: string) => number | null,
    hint: string,
  ) => {
    if (!text.trim()) return null
    const value = parse(text)
    if (value === null) errors[field] = hint
    return value
  }
  const latitude = read('latitude', draft.latitude, parseCoordinate, COORDINATE_HINT)
  const longitude = read('longitude', draft.longitude, parseCoordinate, COORDINATE_HINT)
  const volume = read(
    'stacked_volume',
    draft.stackedVolume,
    (text) =>
      /^\d+(?:[.,]\d+)?$/.test(text.trim()) ? Number(text.trim().replace(',', '.')) : null,
    'Bitte eine Zahl eingeben, mit Komma als Dezimaltrenner (51,52).',
  )
  if (Object.keys(errors).length) return { errors }
  return {
    fields: {
      number: draft.number.trim(),
      location: draft.location.trim() || null,
      latitude,
      longitude,
      stacked_volume: volume,
    },
  }
}

/** "51,52 Rm", always with two decimals. */
export const formatVolume = (volume: number) =>
  `${volume.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Rm`

/** What the form shows under a coordinate once it can be read: "= 51,413056". Null for an empty or unreadable one. */
export function coordinateHint(text: string): string | null {
  const value = parseCoordinate(text)
  return value === null ? null : `= ${String(value).replace('.', ',')}`
}

/** Where the pile is on the map; the link opens it with a marker. */
export const mapUrl = (pile: Pick<AdminPile, 'latitude' | 'longitude'>): string | null =>
  pile.latitude === null || pile.longitude === null
    ? null
    : `https://www.openstreetmap.org/?mlat=${pile.latitude}&mlon=${pile.longitude}#map=16/${pile.latitude}/${pile.longitude}`

/** "field → message" of a 422 (the same shape as for the attributes). */
export const pileErrorsOf = errorsOf

/** The text of the page for a count, "1 Polter" / "5 Polter". */
export const countPiles = (n: number) => `${n} Polter`
