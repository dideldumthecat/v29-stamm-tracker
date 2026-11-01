/**
 * The app's own report of what happened on the device: errors, failed requests, flow steps (see POST /api/diagnostics
 * in contract.ts). Entries wait in IndexedDB until send.ts has delivered them.
 *
 * Nothing in here may break the app: recording is fire-and-forget and swallows every failure, including an
 * unavailable device storage. What must never be recorded: attribute values, invite codes, photo contents, URLs with a
 * query or hash. Callers pass counts, ids, statuses and the like.
 */
import type { App } from 'vue'
import type { DiagnosticEntry } from '@/api/contract'
import { APP_BUILD } from '@/config/constants'
import { addDiagnostic } from '@/persistence/database'

type Level = DiagnosticEntry['level']
export type Context = Record<string, string | number | boolean | null | undefined>

let onProblem: (() => void) | undefined

/** send.ts hooks in here to send shortly after an error or warning. */
export function setProblemListener(listener: (() => void) | undefined) {
  onProblem = listener
}

/**
 * Where the user is and whether the app can reach the network; the route without query and hash.
 * The build is fixed when the entry is recorded: an entry may be sent later by a newer build (header X-App-Build).
 */
function surroundings(): Context {
  return {
    recorded_build: APP_BUILD,
    route: location.pathname,
    online: navigator.onLine,
    visible: document.visibilityState === 'visible',
  }
}

export function createEntry(
  level: Level,
  kind: string,
  message: string,
  context: Context = {},
): DiagnosticEntry {
  // Flat scalars only, as the server demands; anything else would make the whole report a 400.
  const flat = Object.entries({ ...surroundings(), ...context }).filter(
    ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
  )
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    level,
    kind,
    message,
    count: 1,
    context: Object.fromEntries(flat) as DiagnosticEntry['context'],
  }
}

/** Never rejects. Resolves when the entry is stored (or the attempt failed), for the few callers that reload next. */
export async function record(
  level: Level,
  kind: string,
  message: string,
  context?: Context,
): Promise<void> {
  try {
    await addDiagnostic(createEntry(level, kind, message, context))
    if (level !== 'info') {
      onProblem?.()
    }
  } catch {
    // Logging must never be the problem.
  }
}

export function describeError(error: unknown): Context {
  return error instanceof Error
    ? { error_name: error.name, stack: error.stack?.slice(0, 500) }
    : { error_value: String(error).slice(0, 500) }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Uncaught errors, unhandled promise rejections and, if given the app, errors inside Vue components and watchers.
 * Returns the function that removes the listeners (for tests).
 */
export function captureErrors(app?: App): () => void {
  const onError = (event: ErrorEvent) =>
    void record(
      'error',
      'uncaught_error',
      messageOf(event.error ?? event.message),
      describeError(event.error),
    )
  const onRejection = (event: PromiseRejectionEvent) =>
    void record(
      'error',
      'unhandled_rejection',
      messageOf(event.reason),
      describeError(event.reason),
    )
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  if (app) {
    app.config.errorHandler = (error, _instance, info) => {
      // A handler replaces Vue's own logging, so keep the console output for development.
      console.error(error)
      void record('error', 'vue_error', messageOf(error), { ...describeError(error), info })
    }
  }
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

const BUILD_KEY = 'app-build'

/** The first start of a new build is the proof that an update took effect. */
export function recordBuildChange() {
  try {
    const previous = localStorage.getItem(BUILD_KEY)
    if (previous !== APP_BUILD) {
      localStorage.setItem(BUILD_KEY, APP_BUILD)
      if (previous) {
        void record('info', 'update', 'New version active', { from: previous, to: APP_BUILD })
      }
    }
  } catch {
    // No localStorage (private window): nothing to compare with.
  }
}
