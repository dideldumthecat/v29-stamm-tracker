// Ways to bring the store into a state that its actions alone do not reach; the state itself is read-only.
import { toRaw } from 'vue'
import { expect, vi } from 'vitest'
import type { Event, Snapshot } from '@v29/shared/contract'
import { api } from '@/api/client'
import { load as loadStored, save } from '@/persistence/database'
import { useTimberItemStore } from '@/stores/timberItems'

/**
 * Restarts the store with this queue on the device, as an older app version or an interrupted sync may
 * have left it. Stored photo files go, everything else is kept as the store holds it.
 */
export async function restartWith(events: Event[]) {
  const store = useTimberItemStore()
  await vi.waitFor(() => expect(store.pendingWrites).toBe(0))
  const stored = await loadStored()
  await save(
    {
      events: events.map((event) => structuredClone(toRaw(event))),
      snapshot: structuredClone(toRaw(store.snapshot)) as Snapshot,
      user: structuredClone(toRaw(store.currentUser)),
      lastSyncedAt: store.lastSyncedAt,
    },
    { remove: stored.photos.map((photo) => photo.id) },
  )
  await store.load()
}

/** Starts a sync that waits for its download until the returned function lets it finish. */
export function holdSync(): () => Promise<void> {
  let release!: () => void
  const download = new Promise<void>((resolve) => (release = resolve))
  const loadSnapshot = vi
    .spyOn(api, 'loadSnapshot')
    .mockImplementationOnce(() => download.then(() => api.initialSnapshot()))
  const running = useTimberItemStore().sync()
  return async () => {
    release()
    await running
    loadSnapshot.mockRestore()
  }
}

/** The store as on a device where nobody has signed in yet; call before the store is first used. */
export function signedOut() {
  vi.spyOn(api, 'initialUser').mockReturnValueOnce(null)
}
