import type { ActivityEntry, ActivityResponse } from '../api/contract'
import { parseTags } from '../listFilters'
import fixture from '@v29/shared/fixtures/activity-response.json' with { type: 'json' }

/** The 31 October as the server answered it (the backend tests expect exactly this file). */
export const activityFixture = fixture as unknown as ActivityResponse

/**
 * Answers GET /api/admin/activity from the fixture, as far as the tests need it: the filters user (one or several ids) and tags
 * (numbers and ranges like 104 or 100-120, a stem's beams match too; a beam tag like 104-A matches only that beam) and paging by `before`.
 * Dates are not imitated.
 * Returns null where the server answers 400: a tags filter it cannot read.
 * A page holds `pageSize` entries; the cursor is the index of the next one.
 */
export function activityAnswer(query: URLSearchParams, pageSize = 50): ActivityResponse | null {
  const tag = query.get('tags')
  const people = query.get('user')?.split(',')
  let entries = activityFixture.entries.filter((entry) => !people || people.includes(entry.user.id))
  if (tag) {
    const tags = parseTags(tag)
    if (!tags) return null
    // "104-A" is a beam of stem 104: numbers and ranges match it with its stem, a beam tag only itself
    const matches = (label: string) =>
      tags.ranges.some(
        ([from, to]) => Number.parseInt(label) >= from && Number.parseInt(label) <= to,
      ) || tags.beams.includes(label)
    entries = entries
      .map((entry) => keepMatching(entry, matches))
      .filter((entry) => entry.items.length)
  }
  const start = Number(query.get('before') ?? 0)
  const page = entries.slice(start, start + pageSize)
  const changes = entries.flatMap((entry) => entry.items.flatMap((item) => item.changes))
  return {
    entries: page,
    next_cursor: start + pageSize < entries.length ? String(start + pageSize) : null,
    // The fixture's own `entries_unfiltered` is 7 because the server counted the stems of 30 October too (the request
    // had from=2026-10-31); dates are not imitated here, so all fixture entries are all entries.
    entries_unfiltered: activityFixture.entries.length,
    totals: {
      entries: entries.length,
      events: entries.reduce((sum, entry) => sum + entry.event_count, 0),
      photos: changes.filter((change) => change.kind === 'photo').length,
      users: new Set(entries.map((entry) => entry.user.id)).size,
    },
    users: activityFixture.users,
  }
}

function keepMatching(entry: ActivityEntry, matches: (label: string) => boolean): ActivityEntry {
  const items = entry.items.filter((item) => matches(item.label))
  return {
    ...entry,
    items,
    event_count: items.reduce((sum, item) => sum + item.changes.length, 0),
  }
}
