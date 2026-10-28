import { useTimberItemStore } from '@/stores/timberItems'

// Short stays at other apps (camera, messages) are common; one download per return is enough.
export const MIN_REFRESH_INTERVAL_MS = 60_000

/**
 * Downloads the current state when the app opens and whenever it comes back to the foreground.
 * Download only: pending entries (later with large photos) leave the device by the sync button alone.
 * Failures stay silent; the time shown on the start screen simply does not move.
 * Returns the function that removes the listener.
 */
export function startAutoRefresh(): () => void {
  const store = useTimberItemStore()
  let lastAttempt = -Infinity

  function refresh(respectInterval: boolean) {
    if (!store.currentUser || !navigator.onLine) {
      return
    }
    if (respectInterval && Date.now() - lastAttempt < MIN_REFRESH_INTERVAL_MS) {
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

  document.addEventListener('visibilitychange', onVisibilityChange)
  refresh(false)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}
