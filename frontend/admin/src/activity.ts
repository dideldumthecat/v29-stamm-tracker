import type { ActivityEntry, ActivityItem } from '@v29/shared/contract'

import { countText, plural } from '@/listFilters'

// All times are shown in German time, whatever the browser's time zone is.
const TIME_ZONE = 'Europe/Berlin'
const timeFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** "11:46" */
export const formatTime = (timestamp: string) => timeFormat.format(new Date(timestamp))

/** The parts of the German calendar day of a timestamp; `key` ("2026-10-31") is what entries are grouped by. */
function dayParts(timestamp: string): Record<string, string> {
  const parts: Record<string, string> = Object.fromEntries(
    dayFormat.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  )
  return { ...parts, key: `${parts.year}-${parts.month}-${parts.day}` }
}

/** Whether two timestamps lie on the same German calendar day. */
export const sameDay = (a: string, b: string) => dayParts(a).key === dayParts(b).key

/** "18:00", or "05.11. 18:00" if the device time is not on the day the entry arrived (German time). */
export function formatRecordedTime(timestamp: string, receivedAt: string): string {
  return sameDay(timestamp, receivedAt) ? formatTime(timestamp) : formatDayMonthTime(timestamp)
}

/** "31.10." */
export function formatDayMonth(timestamp: string): string {
  const { day, month } = dayParts(timestamp)
  return `${day}.${month}.`
}

/** The German calendar day of a timestamp as "2026-10-31": what the day filters compare with. */
export const dayKey = (timestamp: string) => dayParts(timestamp).key

/** The German calendar year of a timestamp. */
export const yearOf = (timestamp: string) => Number(dayParts(timestamp).year)

/** "31.10." in the current year (browser date), otherwise with the year in two digits: "31.10.25". */
export function formatDayMonthUnlessThisYear(timestamp: string): string {
  const { day, month, year } = dayParts(timestamp)
  return Number(year) === new Date().getFullYear()
    ? `${day}.${month}.`
    : `${day}.${month}.${year.slice(2)}`
}

/** "31.10. 11:47" */
export const formatDayMonthTime = (timestamp: string) =>
  `${formatDayMonth(timestamp)} ${formatTime(timestamp)}`

/** "31.10.2026" */
export function formatDate(timestamp: string): string {
  const { day, month, year } = dayParts(timestamp)
  return `${day}.${month}.${year}`
}

/** "31.10.2026, 11:47" */
export function formatDateTime(timestamp: string): string {
  return `${formatDate(timestamp)}, ${formatTime(timestamp)}`
}

export interface Day {
  /** The German calendar day, "2026-10-31": what entries are grouped by. */
  key: string
  /** "Sa, 31.10.2026" */
  heading: string
  entries: ActivityEntry[]
}

/** Groups entries (newest first) by the German day they arrived on; the order stays. */
export function groupByDay(entries: ActivityEntry[]): Day[] {
  const days: Day[] = []
  let current: Day | undefined
  for (const entry of entries) {
    const parts = dayParts(entry.received_at)
    const { key } = parts
    const weekday = parts.weekday.replace('.', '')
    if (current?.key !== key) {
      current = {
        key,
        heading: `${weekday}, ${parts.day}.${parts.month}.${parts.year}`,
        entries: [],
      }
      days.push(current)
    }
    current.entries.push(entry)
  }
  return days
}

/**
 * The days a list may show. While the server has more entries (`hasMore`), the oldest loaded day may continue on the
 * next page, so it is held back: a day is never shown with only some of its entries.
 */
export const completeDays = (days: Day[], hasMore: boolean) => (hasMore ? days.slice(0, -1) : days)

export const eventsText = (n: number) => plural(n, 'Ereignis', 'Ereignisse')

/** "248 Einträge", with a filter "12 von 248 Einträgen". */
export const entriesText = (shown: number, total: number, filtered: boolean) =>
  countText(shown, total, filtered, ['Eintrag', 'Einträge', 'Einträgen'])

/** A beam carries its stem's number plus a letter ("104-C"), a stem does not. */
const isBeam = (label: string) => label.includes('-')

interface Who {
  stems: Set<string>
  beams: Set<string>
}

const stemsAndBeams = (who: Who) =>
  [
    who.stems.size && plural(who.stems.size, 'Stamm', 'Stämme'),
    who.beams.size && plural(who.beams.size, 'Balken', 'Balken'),
  ]
    .filter(Boolean)
    .join(', ')

/**
 * The bullet points of an entry, no tags, counted by `kind` and `name` of the changes. Distinct stems and beams are counted,
 * not events (photos are counted as photos). Order: created, attributes by first appearance, photos, removed photos, tag changes, voided,
 * restored. Empty lines are left out.
 */
export function summarize(entry: ActivityEntry): string[] {
  const created = { stems: new Set<string>(), beams: new Set<string>() }
  const values = new Map<string, Who>()
  const voided = new Map<string, Who>()
  const restored = new Map<string, Who>()
  let photos = 0
  let removedPhotos = 0
  let tags = 0
  const note = (map: Map<string, Who>, name: string, label: string) => {
    const who = map.get(name) ?? { stems: new Set<string>(), beams: new Set<string>() }
    who[isBeam(label) ? 'beams' : 'stems'].add(label)
    map.set(name, who)
  }

  for (const item of entry.items) {
    const isNew = item.changes.some((change) => change.kind === 'created')
    for (const change of item.changes) {
      if (change.kind === 'created') created[isBeam(item.label) ? 'beams' : 'stems'].add(item.label)
      else if (change.kind === 'value') note(values, change.name, item.label)
      else if (change.kind === 'photo') photos++
      else if (change.kind === 'photo_removed') removedPhotos++
      // The tag of a new item is part of its creation.
      else if (change.kind === 'tag') tags += isNew ? 0 : 1
      else note(change.kind === 'voided' ? voided : restored, change.name, item.label)
    }
  }

  // Stems and beams as a whole: "2 Stämme storniert"; anything else: "Gesägt storniert – 2 Stämme"
  const lifecycle = (map: Map<string, Who>, verb: string) =>
    [...map].map(([name, who]) =>
      name === 'Stamm' || name === 'Balken'
        ? `${plural(who.stems.size + who.beams.size, name, name === 'Stamm' ? 'Stämme' : name)} ${verb}`
        : `${name} ${verb} – ${stemsAndBeams(who)}`,
    )

  const lines = [
    created.stems.size && `${plural(created.stems.size, 'Stamm', 'Stämme')} angelegt`,
    created.beams.size && `${plural(created.beams.size, 'Balken', 'Balken')} angelegt`,
    ...[...values].map(([name, who]) => `${name} – ${stemsAndBeams(who)}`),
    photos && plural(photos, 'Foto', 'Fotos'),
    removedPhotos && `${plural(removedPhotos, 'Foto', 'Fotos')} entfernt`,
    tags && `${plural(tags, 'Kennung', 'Kennungen')} geändert`,
    ...lifecycle(voided, 'storniert'),
    ...lifecycle(restored, 'wiederhergestellt'),
  ]
  return lines.filter((line): line is string => Boolean(line))
}

/**
 * The rows of the detail table for one stem or beam, in the order of the contract. Changes with the same name and value
 * become one row at the first of them, with a count before the value ("2 storniert"); set values stay one row each.
 * Photos (added and removed) always show their count ("1 hinzugefügt", "1 entfernt"), everything else from 2 on. The tag of a new item is left out: it is
 * part of its creation.
 */
export function detailRows(item: ActivityItem) {
  const isNew = item.changes.some((change) => change.kind === 'created')
  const rows = new Map<string, { name: string; value: string; kind: string; count: number }>()
  for (const change of item.changes) {
    if (change.kind === 'tag' && isNew) continue
    const key = change.kind === 'value' ? String(rows.size) : `${change.name}\0${change.value}`
    const row = rows.get(key)
    if (row) row.count++
    else rows.set(key, { name: change.name, value: change.value, kind: change.kind, count: 1 })
  }
  return [...rows.values()].map((row) => ({
    name: row.name,
    value:
      row.kind === 'photo' || row.kind === 'photo_removed' || row.count > 1
        ? `${row.count} ${row.value}`
        : row.value,
  }))
}

/** "31.10." for a day "2026-10-31" of the current year, otherwise with the year in two digits: "31.10.25". */
function formatDayShort(day: string): string {
  const [year, month, date] = day.split('-')
  return Number(year) === new Date().getFullYear()
    ? `${date}.${month}.`
    : `${date}.${month}.${year.slice(2)}`
}

/** The period filter in words, for its chip: "01.11.–12.11.", "ab 01.11.", "bis 12.11."; days as in the URL ("2026-11-01"). */
export function describePeriod(from: string, to: string): string {
  if (from && to) return `${formatDayShort(from)}–${formatDayShort(to)}`
  return from ? `ab ${formatDayShort(from)}` : `bis ${formatDayShort(to)}`
}
