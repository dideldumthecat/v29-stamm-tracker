import { watch } from 'vue'
import { record } from '@/diagnostics/record'
import { useTimberItemStore } from '@/stores/timberItems'

// Short stays at other apps (camera, messages) are common; one download per return is enough.
export const MIN_REFRESH_INTERVAL_MS = 60_000

/**
 * Downloads the current state when the app opens and whenever it comes back to the foreground.
 * Download only: pending entries (later with large photos) leave the device by the sync button alone.
 * Failures stay silent; the time shown on the start screen simply does not move.
 * While a draft is open nothing is downloaded (attributes would change under it); one download follows
 * as soon as the draft is saved or discarded, whatever the minimum interval says.
 * Returns the function that removes the listener.
 */
export function startAutoRefresh(): () => void {
  const store = useTimberItemStore()
  let lastAttempt = -Infinity
  let deferred = false

  function refresh(respectInterval: boolean) {
    if (!store.currentUser || !navigator.onLine) {
      return
    }
    if (respectInterval && Date.now() - lastAttempt < MIN_REFRESH_INTERVAL_MS) {
      return
    }
    if (store.isDraftOpen) {
      if (!deferred) {
        void record('info', 'update', 'Refresh deferred (draft open)')
      }
      deferred = true
      return
    }
    // Counts failures too, so bad reception does not turn into a request on every return.
    lastAttempt = Date.now()
    store.refresh().catch(() => {})
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      refresh(true)
    }
  }

  const stopWatching = watch(
    () => store.isDraftOpen,
    (open) => {
      if (!open && deferred) {
        deferred = false
        refresh(false)
      }
    },
  )
  document.addEventListener('visibilitychange', onVisibilityChange)
  refresh(false)
  return () => {
    stopWatching()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
