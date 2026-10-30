import { describe, it, expect } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
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
      photos: [],
    })

    const events = syncRequest.events as Event[]
    await save({ events: events.slice(0, 2), lastSyncedAt: '2026-10-22T10:00:00.000Z' })
    await save({ events })

    const stored = await load()
    expect(stored.events.map((event) => event.id)).toEqual(events.map((event) => event.id))
    expect(stored.lastSyncedAt).toBe('2026-10-22T10:00:00.000Z')
  })

  it('stores photos next to the state and removes them in the same transaction', async () => {
    const photo = (id: string) => ({
      id,
      timber_item_id: 'item',
      taken_at: '2026-10-30T10:00:00.000Z',
      size: 3,
      // Node's Blob: the one structuredClone (and so the fake IndexedDB) knows.
      blob: new NodeBlob(['abc'], { type: 'image/jpeg' }) as unknown as Blob,
    })
    await save({ lastSyncedAt: '2026-10-30T10:00:00.000Z' }, { add: [photo('a')] })
    await save({}, { add: [photo('b')] })
    expect((await load()).photos.map((stored) => stored.id)).toEqual(['a', 'b'])

    await save({ lastSyncedAt: null }, { remove: ['a'] })
    const stored = await load()
    expect(stored.photos.map((entry) => entry.id)).toEqual(['b'])
    expect(stored.photos[0]!.blob.size).toBe(3)
    expect(stored.lastSyncedAt).toBeNull()
  })
})
