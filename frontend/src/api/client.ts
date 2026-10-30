/**
 * The only module that talks to the server. VITE_API=fake (dev server and tests, see .env.development and .env.test)
 * swaps in the fixtures and a sync that accepts everything, so the app runs without the backend.
 */
import type {
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

export type User = SessionResponse['user']

/** Any failed request. status 0 = no connection; otherwise the HTTP status (see contract.ts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
 * any lost connection; the caller knows whether it aborted.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers:
        body === undefined || body instanceof FormData
          ? undefined
          : { 'Content-Type': 'application/json' },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw new ApiError(0, String(error))
  }
  if (!response.ok) {
    // Symfony answers errors as problem details: { "detail": "…" }.
    const problem = await response.json().catch(() => null)
    throw new ApiError(response.status, problem?.detail ?? response.statusText)
  }
  return response.json()
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
  uploadPhoto: async (_photo, signal) => {
    signedIn()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, FAKE_UPLOAD_MS)
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
  // A fresh device starts with the fixture, so screens and tests have data without a sync.
  initialSnapshot: () => structuredClone(fixtureSnapshot),
  initialUser: () => (isSignedOut() ? null : { ...sessionFixture.user }),
}

export const api = import.meta.env.VITE_API === 'fake' ? fake : real
