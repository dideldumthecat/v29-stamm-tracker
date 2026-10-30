import { describe, it, expect } from 'vitest'
import { openDB } from 'idb'
import { load } from '@/persistence/database'
import syncRequest from '@/api/fixtures/sync-request.json'
import type { Event } from '@/api/contract'

// Own file: the database is opened once per module, and this test needs the old version first.
describe('device storage upgrade', () => {
  it('keeps what version 1 stored and adds the photo store', async () => {
    const old = await openDB('v29-stamm-tracker', 1, {
      upgrade: (db) => db.createObjectStore('state'),
    })
    const events = syncRequest.events as Event[]
    await old.put('state', events, 'events')
    await old.put('state', '2026-10-22T10:00:00.000Z', 'lastSyncedAt')
    old.close()

    const stored = await load()
    expect(stored.events.map((event) => event.id)).toEqual(events.map((event) => event.id))
    expect(stored.lastSyncedAt).toBe('2026-10-22T10:00:00.000Z')
    expect(stored.photos).toEqual([])
  })
})
