import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { save, type PhotoChanges, type StoredPhoto, type StoredState } from '@/persistence/database'
import { record } from '@/diagnostics/record'

interface PersistenceContext {
  /** Writes that have started and not yet ended, successfully or not. */
  pendingWrites: Ref<number>
  pendingCount: ComputedRef<number>
  /** Everything the device storage should hold, as the memory has it now. */
  wholeState: () => { parts: StoredState; photos: StoredPhoto[] }
}

export function createPersistence({ pendingWrites, pendingCount, wholeState }: PersistenceContext) {
  let collected: { parts: Partial<StoredState>; add: StoredPhoto[] } | null = null
  // The device storage may lack something the memory has: a write failed, even after a second try on a new connection.
  const isBehind = ref(false)
  // Counts the failures, so a whole write that started before a later failure does not clear the flag.
  let failures = 0
  // What is only in memory is lost with the app; the notice asks to sync. Nothing pending, nothing to lose.
  const hasUnsaved = computed(() => isBehind.value && pendingCount.value > 0)

  watch(
    hasUnsaved,
    (shown, wasShown) => {
      if (wasShown && !shown) {
        void record('info', 'device_storage', 'Notice about unsaved entries gone', {
          reason: isBehind.value ? 'synced' : 'saved',
        })
      }
    },
    { flush: 'sync' },
  )

  function failed(error: unknown) {
    failures++
    isBehind.value = true
    // Not instanceof Error: a DOMException from IndexedDB is not one in every environment.
    const { name = 'unknown error', message = String(error) } = (error ?? {}) as Partial<Error>
    // The name is in the message: records with the same message are merged, keeping the first one's details.
    void record('warning', 'device_storage', `Saving on the device failed (${name})`, {
      error_name: name,
      error_message: message.slice(0, 300),
      pending_entries: pendingCount.value,
    })
  }

  function persist(parts: Partial<StoredState>, photoChanges?: PhotoChanges) {
    if (collected) {
      // Only additions are batched: removals never happen inside a batch.
      Object.assign(collected.parts, parts)
      collected.add.push(...(photoChanges?.add ?? []))
      return
    }
    // Behind: write everything the memory has, not just this change, so one success closes the gap.
    const whole = isBehind.value
    const failuresBefore = failures
    // Without photo changes the call stays as it was: only the parts.
    const hasPhotoChanges =
      photoChanges && (photoChanges.add?.length || photoChanges.remove?.length)
    pendingWrites.value++
    const state = whole ? wholeState() : null
    ;(state
      ? save(state.parts, { replaceAll: state.photos })
      : hasPhotoChanges
        ? save(parts, photoChanges)
        : save(parts)
    )
      .then(() => {
        if (whole && failures === failuresBefore) isBehind.value = false
      }, failed)
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

  return { persist, inOneTransaction, hasUnsaved }
}
