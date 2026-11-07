import type { Ref } from 'vue'
import { save, type PhotoChanges, type StoredPhoto, type StoredState } from '@/persistence/database'
import { useToast } from '@/composables/useToast'

// pendingWrites: writes that have started and not yet ended, successfully or not.
export function createPersistence(pendingWrites: Ref<number>) {
  let collected: { parts: Partial<StoredState>; add: StoredPhoto[] } | null = null

  // A failed write only warns; the change stays in memory until the app is closed.
  function persist(parts: Partial<StoredState>, photoChanges?: PhotoChanges) {
    if (collected) {
      // Only additions are batched: removals never happen inside a batch.
      Object.assign(collected.parts, parts)
      collected.add.push(...(photoChanges?.add ?? []))
      return
    }
    // Without photo changes the call stays as it was: only the parts.
    const hasPhotoChanges =
      photoChanges && (photoChanges.add?.length || photoChanges.remove?.length)
    pendingWrites.value++
    ;(hasPhotoChanges ? save(parts, photoChanges) : save(parts))
      .catch(() =>
        useToast().show({ before: 'Speichern auf dem Gerät fehlgeschlagen', kind: 'warning' }),
      )
      // A failed write counts as ended too, or the update would wait forever.
      .finally(() => pendingWrites.value--)
  }

  /**
   * Runs `changes` and writes everything it recorded in one transaction: a crash leaves all of it or none.
   * The in-memory state changes at once; only the write waits.
   */
  function inOneTransaction<T>(changes: () => T): T {
    const outer = collected
    const batch = (collected ??= { parts: {}, add: [] })
    try {
      return changes()
    } finally {
      collected = outer
      if (!outer) {
        persist(batch.parts, { add: batch.add })
      }
    }
  }

  return { persist, inOneTransaction }
}
