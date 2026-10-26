import { describe, it, expect } from 'vitest'
import { load, save } from '@/persistence/database'
import syncRequest from '@/api/fixtures/sync-request.json'
import type { Event } from '@/api/contract'

describe('device storage', () => {
  it('starts empty and keeps the queue order across saves', async () => {
    expect(await load()).toEqual({
      user: null,
      snapshot: null,
      events: [],
      lastSyncedAt: null,
    })

    const events = syncRequest.events as Event[]
    await save({ events: events.slice(0, 2), lastSyncedAt: '2026-10-22T10:00:00.000Z' })
    await save({ events })

    const stored = await load()
    expect(stored.events.map((event) => event.id)).toEqual(events.map((event) => event.id))
    expect(stored.lastSyncedAt).toBe('2026-10-22T10:00:00.000Z')
  })
})
