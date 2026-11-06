import type { ActivityEntry, ActivityItem } from '@v29/shared/contract'

// All times are shown in German time, whatever the browser's time zone is.
const TIME_ZONE = 'Europe/Berlin'
const number = new Intl.NumberFormat('de-DE')
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

/** "erfasst 11:46–11:48", or one time if the entry began and ended in the same minute. */
export function recordedRange(entry: ActivityEntry): string {
  const from = formatTime(entry.recorded_from)
  const to = formatTime(entry.recorded_to)
  return `erfasst ${from === to ? from : `${from}–${to}`}`
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
    const parts = Object.fromEntries(
      dayFormat.formatToParts(new Date(entry.received_at)).map((part) => [part.type, part.value]),
    )
    const key = `${parts.year}-${parts.month}-${parts.day}`
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

const plural = (n: number, one: string, many: string) =>
  `${number.format(n)} ${n === 1 ? one : many}`

export const eventsText = (n: number) => plural(n, 'Ereignis', 'Ereignisse')

export const entriesText = (n: number) => plural(n, 'Eintrag', 'Einträge')

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
 * not events (photos are counted as photos). Order: created, attributes by first appearance, photos, tag changes, voided,
 * restored. Empty lines are left out.
 */
export function summarize(entry: ActivityEntry): string[] {
  const created = { stems: new Set<string>(), beams: new Set<string>() }
  const values = new Map<string, Who>()
  const voided = new Map<string, Who>()
  const restored = new Map<string, Who>()
  let photos = 0
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
    tags && `${plural(tags, 'Kennung', 'Kennungen')} geändert`,
    ...lifecycle(voided, 'storniert'),
    ...lifecycle(restored, 'wiederhergestellt'),
  ]
  return lines.filter((line): line is string => Boolean(line))
}

/**
 * The rows of the detail table for one stem or beam, in the order of the contract. Changes with the same name and value
 * become one row at the first of them, with a count before the value ("2 storniert"); set values stay one row each.
 * Photos always show their count ("1 hinzugefügt"), everything else from 2 on. The tag of a new item is left out: it is
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
    value: row.kind === 'photo' || row.count > 1 ? `${row.count} ${row.value}` : row.value,
  }))
}

const MAX_TAG_NUMBER = 1999

/**
 * Whether the server would read this "Kennung" filter: the same rule as `StemSelection::parseRange` in the backend
 * ("all", or parts like 104 and 100-120 joined by commas, numbers 1 to 1999, blanks around parts ignored).
 * Used to search while typing only for input that is complete.
 */
export function isReadableTags(text: string): boolean {
  if (text.trim() === 'all') return true
  return text.split(',').every((part) => {
    const match = /^\s*0*(\d+)\s*(?:-\s*0*(\d+)\s*)?$/.exec(part)
    if (!match) return false
    const from = Number(match[1])
    const to = Number(match[2] ?? match[1])
    return from >= 1 && from <= to && to <= MAX_TAG_NUMBER
  })
}
