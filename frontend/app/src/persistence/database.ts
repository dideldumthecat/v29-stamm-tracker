/**
 * Device storage (IndexedDB). Only the store uses it.
 *
 * Object store "state": key-value, each part of the state is saved as a whole under its own key.
 * The parts are small (the queue holds what was recorded since the last sync), and writing whole
 * values keeps the queue order without any index.
 * Object store "photos": one entry per photo not uploaded yet, so a big blob is never rewritten
 * with the queue. A photo leaves the store once the server has it.
 * Object store "diagnostics": the app's own error and flow reports until the server has them (src/diagnostics).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { DiagnosticEntry, Event, Snapshot, Timestamp, Uuid } from '@v29/shared/contract'
import type { User } from '@/api/client'
import { DIAGNOSTICS_MAX_AGE_MS, DIAGNOSTICS_MAX_ENTRIES } from '@/config/constants'

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
  diagnostics: { key: Uuid; value: DiagnosticEntry }
}

let database: Promise<IDBPDatabase<Schema>> | undefined

function open() {
  database ??= openDB<Schema>('v29-stamm-tracker', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('state')
      }
      if (oldVersion < 2) {
        db.createObjectStore('photos', { keyPath: 'id' })
      }
      if (oldVersion < 3) {
        db.createObjectStore('diagnostics', { keyPath: 'id' })
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

/** Oldest first, without what is too old. */
function freshDiagnostics(entries: DiagnosticEntry[]) {
  const oldest = Date.now() - DIAGNOSTICS_MAX_AGE_MS
  return entries
    .filter((entry) => Date.parse(entry.at) >= oldest)
    .sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * Adds an entry; the same kind and message as an unsent one only raises its count. Keeps the newest
 * DIAGNOSTICS_MAX_ENTRIES and drops entries older than DIAGNOSTICS_MAX_AGE_MS.
 */
export async function addDiagnostic(entry: DiagnosticEntry) {
  const tx = (await open()).transaction('diagnostics', 'readwrite')
  const store = tx.objectStore('diagnostics')
  const all = await store.getAll()
  const same = all.find((other) => other.kind === entry.kind && other.message === entry.message)
  if (same) {
    same.count += entry.count
    await store.put(same)
  } else {
    await store.put(entry)
    all.push(entry)
  }
  const keep = new Set(
    freshDiagnostics(all)
      .slice(-DIAGNOSTICS_MAX_ENTRIES)
      .map(({ id }) => id),
  )
  for (const { id } of all) {
    if (!keep.has(id)) await store.delete(id)
  }
  await tx.done
}

/** Unsent entries, oldest first. */
export async function loadDiagnostics(): Promise<DiagnosticEntry[]> {
  return freshDiagnostics(await (await open()).getAll('diagnostics'))
}

/**
 * The server has these (as they were when sent). An entry that counted further meanwhile stays with the
 * repeats the server has not seen.
 */
export async function removeDiagnostics(sent: Pick<DiagnosticEntry, 'id' | 'count'>[]) {
  const tx = (await open()).transaction('diagnostics', 'readwrite')
  const store = tx.objectStore('diagnostics')
  for (const { id, count } of sent) {
    const stored = await store.get(id)
    if (!stored) continue
    if (stored.count > count) {
      await store.put({ ...stored, count: stored.count - count })
    } else {
      await store.delete(id)
    }
  }
  await tx.done
}
