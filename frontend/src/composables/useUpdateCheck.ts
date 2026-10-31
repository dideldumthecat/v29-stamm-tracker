import { record } from '@/diagnostics/record'

// Same reasoning as MIN_REFRESH_INTERVAL_MS: short stays at other apps should not each cost a request.
export const MIN_UPDATE_CHECK_INTERVAL_MS = 60_000
export const UPDATE_CHECK_PERIOD_MS = 60 * 60_000
// Longer than a normal activation, short enough that the user does not give up and force-quit the app.
export const APPLY_UPDATE_TIMEOUT_MS = 4000
// After the timeout the report gets this long to reach device storage before the page goes.
export const RELOAD_GRACE_MS = 300

// Set by startUpdateCheck; stays null in development and tests, where nothing is registered.
let activeRegistration: ServiceWorkerRegistration | null = null

// A worker that is already installing will report itself; a second update() would only race it.
function canUpdate(registration: ServiceWorkerRegistration): boolean {
  return navigator.onLine && !registration.installing
}

async function update(registration: ServiceWorkerRegistration) {
  try {
    await registration.update()
  } catch {
    // Offline or server unreachable: the next trigger tries again.
  }
}

/**
 * Checks right now, without the minimum interval: for deliberate actions (manual sync) with proven reception.
 * Does nothing without a registration. Failures stay silent.
 */
export async function checkForUpdateNow(): Promise<void> {
  if (activeRegistration && canUpdate(activeRegistration)) {
    await update(activeRegistration)
  }
}

/**
 * Activates the waiting service worker and reloads once it has taken over.
 * vite-plugin-pwa only reloads on `controllerchange`, which iOS standalone apps do not reliably deliver,
 * so this watches the worker's own state and falls back to a reload after a timeout. Reloads at most once.
 */
export function applyUpdate(updateServiceWorker: (reloadPage?: boolean) => Promise<void>): void {
  let reloaded = false
  function reload() {
    if (!reloaded) {
      reloaded = true
      window.location.reload()
    }
  }

  const waiting = activeRegistration?.waiting
  void record('info', 'update', 'Update requested', { waiting: !!waiting })
  waiting?.addEventListener('statechange', () => {
    if (waiting.state === 'activated') {
      // Not reported here: the first start of the new build does that (recordBuildChange).
      reload()
    }
  })
  setTimeout(() => {
    if (!reloaded) {
      void record('warning', 'update', 'Update did not activate in time, reloading anyway')
      setTimeout(reload, RELOAD_GRACE_MS)
    }
  }, APPLY_UPDATE_TIMEOUT_MS)
  void updateServiceWorker(true)
}

/**
 * Looks for a new service worker when the app returns to the foreground and every 60 minutes while open.
 * Without this the browser only checks on a cold start, and an installed app can stay in memory for days.
 * Detection only: what happens next (toast or automatic reload) is decided by the registration type.
 * Failures stay silent. Returns the function that removes the listener and the timer.
 */
export function startUpdateCheck(registration: ServiceWorkerRegistration): () => void {
  let lastAttempt = -Infinity
  activeRegistration = registration

  // An update that iOS reports without any error is only visible through these steps.
  if (registration.waiting) {
    void record('info', 'update', 'Update waiting from an earlier visit')
  }
  registration.addEventListener('updatefound', () => {
    void record('info', 'update', 'Update found')
    const installing = registration.installing
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        void record('info', 'update', 'Update waiting')
      } else if (installing.state === 'redundant') {
        void record('warning', 'update', 'Update worker discarded')
      }
    })
  })

  async function check() {
    if (!canUpdate(registration)) {
      return
    }
    // Counts failures too, so bad reception does not turn into a request on every return.
    lastAttempt = Date.now()
    await update(registration)
  }

  function onVisibilityChange() {
    if (
      document.visibilityState === 'visible' &&
      Date.now() - lastAttempt >= MIN_UPDATE_CHECK_INTERVAL_MS
    ) {
      void check()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  const timer = setInterval(() => void check(), UPDATE_CHECK_PERIOD_MS)
  return () => {
    activeRegistration = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
    clearInterval(timer)
  }
}
