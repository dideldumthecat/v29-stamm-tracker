import { describe, it, expect } from 'vitest'
import { openDB } from 'idb'
import { addDiagnostic, load, loadDiagnostics } from '@/persistence/database'
import { createEntry } from '@/diagnostics/record'
import syncRequest from '@v29/shared/fixtures/sync-request.json'
import type { Event } from '@v29/shared/contract'

// Own file: the database is opened once per module, and this test needs the old version first.
describe('device storage upgrade', () => {
  it('keeps what version 1 stored and adds the photo and diagnostics stores', async () => {
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
    expect(await loadDiagnostics()).toEqual([])
    await addDiagnostic(createEntry('info', 'upgrade', 'works'))
    expect(await loadDiagnostics()).toHaveLength(1)
  })
})
