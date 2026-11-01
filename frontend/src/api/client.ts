/**
 * The only module that talks to the server. VITE_API=fake (dev server and tests, see .env.development and .env.test)
 * swaps in the fixtures and a sync that accepts everything, so the app runs without the backend.
 */
import type {
  DiagnosticsRequest,
  Event,
  PhotoUploadFields,
  PhotoUploadResponse,
  SessionResponse,
  Snapshot,
  SyncResponse,
} from '@/api/contract'
// JSON imports are typed loosely (type: string instead of 'choice' | …), hence the casts.
import snapshotFixture from '@/api/fixtures/snapshot.json'
import sessionFixture from '@/api/fixtures/session-response.json'
import { APP_BUILD } from '@/config/constants'
import { record } from '@/diagnostics/record'

export type User = SessionResponse['user']

/** Any failed request. status 0 = no connection; otherwise the HTTP status (see contract.ts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The first 500 characters of an error response that is not JSON (a web server's page, not Symfony's), for the diagnostics. */
    readonly bodyStart?: string,
  ) {
    super(message)
  }
}

/** A photo as it waits on the device. */
export interface PhotoUpload extends PhotoUploadFields {
  blob: Blob
}

/**
 * `body` is sent as JSON, a FormData as multipart. An aborted `signal` (cancel, timeout) ends up as status 0 like
 * any lost connection; the caller knows whether it aborted. `keepalive` lets the request outlive the page.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  keepalive = false,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers:
        body === undefined || body instanceof FormData
          ? { 'X-App-Build': APP_BUILD }
          : { 'X-App-Build': APP_BUILD, 'Content-Type': 'application/json' },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
      signal,
      keepalive,
    })
  } catch (error) {
    throw new ApiError(0, String(error))
  }
  if (!response.ok) {
    // Symfony answers errors as problem details: { "detail": "…" }.
    const text = await response.text().catch(() => '')
    let problem: { detail?: string } | null = null
    try {
      problem = JSON.parse(text)
    } catch {
      // Not JSON: something in front of Symfony answered.
    }
    throw new ApiError(
      response.status,
      problem?.detail ?? response.statusText,
      problem ? undefined : text.slice(0, 500),
    )
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>
}

/**
 * What a failed request means for the diagnostics. Only a stop by the user is harmless; running into the timeout
 * is not. Symfony's own answers (JSON) to a request the app got wrong are warnings, anything else an error.
 */
export function describeFailure(error: ApiError, signal?: AbortSignal) {
  const timedOut =
    !!signal?.aborted && (signal.reason as Error | undefined)?.name === 'TimeoutError'
  const stopped = !!signal?.aborted && !timedOut
  const outcome = stopped
    ? 'stopped'
    : timedOut
      ? 'timeout'
      : error.status === 0
        ? 'no connection'
        : String(error.status)
  const isSymfonyAnswer = error.bodyStart === undefined && error.status > 0 && error.status < 500
  return {
    outcome,
    level: stopped ? 'info' : error.status === 0 || isSymfonyAnswer ? 'warning' : 'error',
    context: {
      status: error.status,
      reason: error.status === 0 ? error.message : undefined,
      body_start: error.bodyStart,
    },
  } as const
}

/** Records a failed request; the request itself is the real or the fake one. */
async function tracked<T>(
  method: string,
  path: string,
  call: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const started = performance.now()
  try {
    return await call()
  } catch (error) {
    if (error instanceof ApiError) {
      const { outcome, level, context } = describeFailure(error, signal)
      void record(level, 'request_failed', `${method} /api/${path} failed (${outcome})`, {
        ...context,
        path: `/api/${path}`,
        duration_ms: Math.round(performance.now() - started),
      })
    }
    throw error
  }
}

const real = {
  redeemInvite: (token: string) => request<SessionResponse>('POST', 'session', { token }),
  loadSnapshot: (signal?: AbortSignal) => request<Snapshot>('GET', 'snapshot', undefined, signal),
  sync: (events: Event[], signal?: AbortSignal) =>
    request<SyncResponse>('POST', 'sync', { events }, signal),
  /** Resolves on 201 and 200 (already known); any other status throws ApiError. */
  uploadPhoto: async (photo: PhotoUpload, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('id', photo.id)
    form.append('timber_item_id', photo.timber_item_id)
    form.append('taken_at', photo.taken_at)
    form.append('file', photo.blob, `${photo.id}.jpg`)
    await request<PhotoUploadResponse>('POST', 'photos', form, signal)
  },
  /** Never logged itself: a failing report must not produce another one. */
  sendDiagnostics: (report: DiagnosticsRequest, keepalive = false) =>
    request<void>('POST', 'diagnostics', report, undefined, keepalive),
  /** State of a device that has never synced. */
  initialSnapshot: (): Snapshot => ({
    schema_version: 1,
    generated_at: new Date(0).toISOString(),
    users: [],
    attributes: [],
    timber_items: [],
  }),
  initialUser: (): User | null => null,
}

const FAKE_UPLOAD_MS = 600

// Test hook: localStorage "fake-api" = "signed-out" starts without a user and answers 401 until the next sign-in.
const isSignedOut = () => localStorage.getItem('fake-api') === 'signed-out'
const signedIn = () => {
  if (isSignedOut()) {
    throw new ApiError(401, 'Unknown or revoked invite link.')
  }
}

// The type inferred from the JSON (empty arrays as never[], optional keys per item) does not overlap Snapshot enough for a direct cast.
const fixtureSnapshot = snapshotFixture as unknown as Snapshot

// structuredClone: callers may mutate the result, the imported fixture must stay as it is.
const fake: typeof real = {
  redeemInvite: async () => {
    localStorage.removeItem('fake-api')
    return structuredClone(sessionFixture)
  },
  // Always the fixture: events "synced" here are accepted and then gone.
  loadSnapshot: async () => {
    signedIn()
    return structuredClone(fixtureSnapshot)
  },
  // Slow on purpose: the progress bar must be visible (and cancellable) in the tests.
  // Test hook: localStorage "fake-api-hold-photos" = "1" never finishes an upload by itself (only stopping ends it),
  // so a test can stop a sync while a photo is certainly still on its way.
  uploadPhoto: async (_photo, signal) => {
    signedIn()
    const hold = localStorage.getItem('fake-api-hold-photos') === '1'
    await new Promise<void>((resolve, reject) => {
      const timer = hold ? undefined : setTimeout(resolve, FAKE_UPLOAD_MS)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new ApiError(0, 'aborted'))
      })
    })
  },
  sync: async (events) => {
    signedIn()
    return { accepted_event_ids: events.map((event) => event.id), rejected: [] }
  },
  // Accepts everything; the reports stay in localStorage for the end-to-end tests to read.
  sendDiagnostics: async (report) => {
    const sent = JSON.parse(localStorage.getItem('fake-api-diagnostics') ?? '[]')
    localStorage.setItem('fake-api-diagnostics', JSON.stringify([...sent, ...report.entries]))
  },
  // A fresh device starts with the fixture, so screens and tests have data without a sync.
  initialSnapshot: () => structuredClone(fixtureSnapshot),
  initialUser: () => (isSignedOut() ? null : { ...sessionFixture.user }),
}

const impl = import.meta.env.VITE_API === 'fake' ? fake : real

// Failed requests are recorded here for both implementations. Photos report themselves in the store (with their
// size, attempt and origin), diagnostics never.
export const api: typeof real = {
  ...impl,
  redeemInvite: (token) => tracked('POST', 'session', () => impl.redeemInvite(token)),
  loadSnapshot: (signal) => tracked('GET', 'snapshot', () => impl.loadSnapshot(signal), signal),
  sync: (events, signal) => tracked('POST', 'sync', () => impl.sync(events, signal), signal),
}
