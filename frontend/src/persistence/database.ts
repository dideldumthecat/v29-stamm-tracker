/**
 * Device storage (IndexedDB). Only the store uses it.
 *
 * One key-value object store: each part of the state is saved as a whole under its own key.
 * The parts are small (the queue holds what was recorded since the last sync), and writing whole
 * values keeps the queue order without any index.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Event, Snapshot, Timestamp, Uuid } from '@/api/contract'
import type { User } from '@/api/client'

export interface StoredState {
  user: User | null
  /** As received from GET /api/snapshot, never changed locally. */
  snapshot: Snapshot | null
  /** Own events not yet confirmed by the server, in the order they were recorded. */
  events: Event[]
  /** Unsynced beams removed on this device: their events never reach the server, but their letters stay taken. */
  removedBeams: { id: Uuid; parent_id: Uuid }[]
  /** Device time of the last successful sync. */
  lastSyncedAt: Timestamp | null
}

type Key = keyof StoredState

interface Schema extends DBSchema {
  state: { key: Key; value: StoredState[Key] }
}

let database: Promise<IDBPDatabase<Schema>> | undefined

function open() {
  database ??= openDB<Schema>('v29-stamm-tracker', 1, {
    upgrade: (db) => db.createObjectStore('state'),
  })
  return database
}

/** Whatever is stored; missing parts are null or empty. */
export async function load(): Promise<StoredState> {
  // Without this the browser may evict the data under storage pressure – unsynced events would be lost.
  // The answer does not matter here: the app works either way.
  navigator.storage?.persist?.().catch(() => {})
  const tx = (await open()).transaction('state')
  const get = async <K extends Key>(key: K) =>
    (await tx.store.get(key)) as StoredState[K] | undefined
  return {
    user: (await get('user')) ?? null,
    snapshot: (await get('snapshot')) ?? null,
    events: (await get('events')) ?? [],
    removedBeams: (await get('removedBeams')) ?? [],
    lastSyncedAt: (await get('lastSyncedAt')) ?? null,
  }
}

/**
 * Writes the given parts in one transaction: all or nothing.
 * Values must be plain data (toRaw for Vue state): IndexedDB cannot store proxies.
 */
export async function save(parts: Partial<StoredState>) {
  // Transactions run in the order they are created, so saves land in the order they were called.
  const tx = (await open()).transaction('state', 'readwrite')
  for (const [key, value] of Object.entries(parts)) {
    tx.store.put(value, key as Key)
  }
  await tx.done
}
