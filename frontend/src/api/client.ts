/**
 * The only module that talks to the server. VITE_API=fake (dev server and tests, see .env.development and .env.test)
 * swaps in the fixtures and a sync that accepts everything, so the app runs without the backend.
 */
import type { Event, SessionResponse, Snapshot, SyncResponse } from '@/api/contract'
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  loadSnapshot: () => request<Snapshot>('GET', 'snapshot'),
  sync: (events: Event[]) => request<SyncResponse>('POST', 'sync', { events }),
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

// Test hook: localStorage "fake-api" = "signed-out" starts without a user and answers 401 until the next sign-in.
const isSignedOut = () => localStorage.getItem('fake-api') === 'signed-out'
const signedIn = () => {
  if (isSignedOut()) {
    throw new ApiError(401, 'Unknown or revoked invite link.')
  }
}

// structuredClone: callers may mutate the result, the imported fixture must stay as it is.
const fake: typeof real = {
  // The invite link /invite#invalid shows the error page.
  redeemInvite: async (token) => {
    if (token === 'invalid') {
      throw new ApiError(401, 'Unknown or revoked invite link.')
    }
    localStorage.removeItem('fake-api')
    return structuredClone(sessionFixture)
  },
  // Always the fixture: events "synced" here are accepted and then gone.
  loadSnapshot: async () => {
    signedIn()
    return structuredClone(snapshotFixture as Snapshot)
  },
  sync: async (events) => {
    signedIn()
    return { accepted_event_ids: events.map((event) => event.id) }
  },
  // A fresh device starts with the fixture, so screens and tests have data without a sync.
  initialSnapshot: () => structuredClone(snapshotFixture as Snapshot),
  initialUser: () => (isSignedOut() ? null : { ...sessionFixture.user }),
}

export const api = import.meta.env.VITE_API === 'fake' ? fake : real
