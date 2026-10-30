/**
 * Device storage (IndexedDB). Only the store uses it.
 *
 * Object store "state": key-value, each part of the state is saved as a whole under its own key.
 * The parts are small (the queue holds what was recorded since the last sync), and writing whole
 * values keeps the queue order without any index.
 * Object store "photos": one entry per photo not uploaded yet, so a big blob is never rewritten
 * with the queue. A photo leaves the store once the server has it.
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
  /** Device time of the last successful sync. */
  lastSyncedAt: Timestamp | null
}

/** A compressed photo waiting for its upload. */
export interface StoredPhoto {
  id: Uuid
  timber_item_id: Uuid
  /** Device time of the shot. */
  taken_at: Timestamp
  /** Bytes of the blob, kept so the list does not have to read the blob. */
  size: number
  blob: Blob
}

/** Photos to add or remove in the same transaction as the state parts. */
export interface PhotoChanges {
  add?: StoredPhoto[]
  remove?: Uuid[]
}

type Key = keyof StoredState

interface Schema extends DBSchema {
  state: { key: Key; value: StoredState[Key] }
  photos: { key: Uuid; value: StoredPhoto }
}

let database: Promise<IDBPDatabase<Schema>> | undefined

function open() {
  database ??= openDB<Schema>('v29-stamm-tracker', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('state')
      }
      if (oldVersion < 2) {
        db.createObjectStore('photos', { keyPath: 'id' })
      }
    },
  })
  return database
}

/** Whatever is stored; missing parts are null or empty. */
export async function load(): Promise<StoredState & { photos: StoredPhoto[] }> {
  // Without this the browser may evict the data under storage pressure – unsynced events would be lost.
  // The answer does not matter here: the app works either way.
  navigator.storage?.persist?.().catch(() => {})
  const tx = (await open()).transaction(['state', 'photos'])
  const get = async <K extends Key>(key: K) =>
    (await tx.objectStore('state').get(key)) as StoredState[K] | undefined
  return {
    user: (await get('user')) ?? null,
    snapshot: (await get('snapshot')) ?? null,
    events: (await get('events')) ?? [],
    lastSyncedAt: (await get('lastSyncedAt')) ?? null,
    photos: await tx.objectStore('photos').getAll(),
  }
}

/**
 * Writes the given parts (and photo changes, if any) in one transaction: all or nothing.
 * Values must be plain data (toRaw for Vue state): IndexedDB cannot store proxies.
 */
export async function save(parts: Partial<StoredState>, photos: PhotoChanges = {}) {
  // Transactions run in the order they are created, so saves land in the order they were called.
  const tx = (await open()).transaction(['state', 'photos'], 'readwrite')
  for (const [key, value] of Object.entries(parts)) {
    tx.objectStore('state').put(value, key as Key)
  }
  for (const photo of photos.add ?? []) {
    tx.objectStore('photos').put(photo)
  }
  for (const id of photos.remove ?? []) {
    tx.objectStore('photos').delete(id)
  }
  await tx.done
}
