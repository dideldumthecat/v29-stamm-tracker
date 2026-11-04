/**
 * Delivers the buffered entries (record.ts) to the server by itself: at app start, whenever the app comes back to
 * the foreground, after every sync and shortly after an error or warning. No button – the entries hold no capture data.
 * Entries leave the device buffer only after the server confirmed them (204). A failed report is not recorded itself:
 * that would be a loop. Nothing goes out without a sign-in: the server would answer 401 and log a false error.
 */
import type { DiagnosticEntry } from '@v29/shared/contract'
import { api, ApiError } from '@/api/client'
import { DIAGNOSTICS_DEBOUNCE_MS } from '@/config/constants'
import { loadDiagnostics, removeDiagnostics } from '@/persistence/database'
import { createEntry, setProblemListener, type Context } from '@/diagnostics/record'

// The server takes 100 entries and 256 KB per request; fetch with keepalive may carry 64 KB at most.
const MAX_ENTRIES = 100
const MAX_CHARS = 200_000
const MAX_CHARS_KEEPALIVE = 60_000

let sending: Promise<void> | null = null
// Asked again while a send was running: entries recorded meanwhile must not wait for the next trigger.
let askedAgain: { keepalive: boolean } | null = null
// Set by the store (user known / not known). A 401 clears it: the entries then wait for the next sign-in.
let signedIn = false

export function setDiagnosticsSignedIn(value: boolean) {
  signedIn = value
}

function nextBatch(entries: DiagnosticEntry[], maxChars: number): DiagnosticEntry[] {
  const batch: DiagnosticEntry[] = []
  let chars = 0
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    chars += JSON.stringify(entry).length
    // One entry always goes: a single oversized one must not block the buffer.
    if (batch.length > 0 && chars > maxChars) break
    batch.push(entry)
  }
  return batch
}

async function sendBuffered(keepalive: boolean) {
  for (;;) {
    const entries = nextBatch(await loadDiagnostics(), keepalive ? MAX_CHARS_KEEPALIVE : MAX_CHARS)
    if (entries.length === 0) {
      return
    }
    await api.sendDiagnostics({ user_agent: navigator.userAgent, entries }, keepalive)
    await removeDiagnostics(entries)
    // A page that is going away gets one request.
    if (keepalive) {
      return
    }
  }
}

/** Never rejects. A send already running is followed by one more. */
export function sendDiagnostics({ keepalive = false } = {}): Promise<void> {
  if (sending) {
    askedAgain = { keepalive: keepalive || !!askedAgain?.keepalive }
    return sending
  }
  if (!signedIn || !navigator.onLine) {
    return Promise.resolve()
  }
  sending = sendBuffered(keepalive)
    .catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        signedIn = false
      }
    })
    .finally(() => {
      sending = null
      const again = askedAgain
      askedAgain = null
      if (again) {
        void sendDiagnostics(again)
      }
    })
  return sending
}

/** For a start without device storage: there is no buffer, so the one entry goes out directly. */
export async function reportWithoutBuffer(kind: string, message: string, context?: Context) {
  try {
    await api.sendDiagnostics({
      user_agent: navigator.userAgent,
      entries: [createEntry('error', kind, message, context)],
    })
  } catch {
    // Nothing else to try.
  }
}

/** Returns the function that removes the listeners (for tests). */
export function startDiagnosticsSending(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  setProblemListener(() => {
    clearTimeout(timer)
    timer = setTimeout(() => void sendDiagnostics(), DIAGNOSTICS_DEBOUNCE_MS)
  })
  const onVisibilityChange = () =>
    void sendDiagnostics({ keepalive: document.visibilityState === 'hidden' })
  document.addEventListener('visibilitychange', onVisibilityChange)
  void sendDiagnostics()
  return () => {
    clearTimeout(timer)
    setProblemListener(undefined)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
