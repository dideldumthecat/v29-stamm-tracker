import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { addDiagnostic, loadDiagnostics, removeDiagnostics } from '@/persistence/database'
import { createEntry, captureErrors, record } from '@/diagnostics/record'
import { sendDiagnostics, reportWithoutBuffer } from '@/diagnostics/send'
import { api, ApiError } from '@/api/client'
import { APP_BUILD, DIAGNOSTICS_MAX_AGE_MS, DIAGNOSTICS_MAX_ENTRIES } from '@/config/constants'

// The device storage is shared by the tests of this file, so every test starts with an empty buffer.
async function clearBuffer() {
  await removeDiagnostics(
    (await loadDiagnostics()).map((entry) => ({ id: entry.id, count: entry.count })),
  )
}

const buffered = () => loadDiagnostics()

describe('diagnostics buffer', () => {
  beforeEach(clearBuffer)
  afterEach(() => vi.useRealTimers())

  it('records errors and unhandled rejections', async () => {
    const stop = captureErrors()
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('boom'), message: 'boom' }))
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('lost promise') }),
    )
    await vi.waitFor(async () => expect(await buffered()).toHaveLength(2))
    stop()

    const entries = await buffered()
    expect(entries.map(({ level, kind, message }) => ({ level, kind, message }))).toEqual(
      expect.arrayContaining([
        { level: 'error', kind: 'uncaught_error', message: 'boom' },
        { level: 'error', kind: 'unhandled_rejection', message: 'lost promise' },
      ]),
    )
    expect(entries[0]!.context).toMatchObject({ online: true, visible: true })
  })

  it('counts a repeated entry instead of adding one', async () => {
    await record('warning', 'sync', 'Sync failed')
    await record('warning', 'sync', 'Sync failed')
    await record('warning', 'sync', 'Sync failed (other)')

    const entries = await buffered()
    expect(entries.map(({ message, count }) => [message, count]).sort()).toEqual([
      ['Sync failed (other)', 1],
      ['Sync failed', 2],
    ])
  })

  it('keeps repeats that came in while a report was on its way', async () => {
    await record('info', 'sync', 'Sync started')
    const [sent] = await buffered()
    await record('info', 'sync', 'Sync started')
    await removeDiagnostics([sent!])

    expect((await buffered()).map((entry) => entry.count)).toEqual([1])
  })

  it('keeps the newest 300 entries and drops entries older than 14 days', async () => {
    const now = Date.parse('2026-10-31T12:00:00.000Z')
    vi.useFakeTimers({ now, toFake: ['Date'] })
    const old = createEntry('info', 'old', 'x')
    old.at = new Date(now - DIAGNOSTICS_MAX_AGE_MS - 1000).toISOString()
    await addDiagnostic(old)
    expect(await buffered()).toEqual([])

    for (let index = 0; index < DIAGNOSTICS_MAX_ENTRIES + 5; index++) {
      const entry = createEntry('info', 'many', `entry ${index}`)
      entry.at = new Date(now + index).toISOString()
      await addDiagnostic(entry)
    }
    const entries = await buffered()
    expect(entries).toHaveLength(DIAGNOSTICS_MAX_ENTRIES)
    expect(entries[0]!.message).toBe('entry 5')
  })

  it('keeps only flat scalar context values and no query or hash of the route', () => {
    history.replaceState(null, '', '/sync?code=secret#top')
    const entry = createEntry('info', 'k', 'm', {
      a: 1,
      b: { nested: true } as never,
      c: undefined,
    })
    expect(entry.context).toEqual({
      recorded_build: APP_BUILD,
      route: '/sync',
      online: true,
      visible: true,
      a: 1,
    })
    history.replaceState(null, '', '/')
  })

  it('never throws when the buffer is unavailable', async () => {
    const database = await import('@/persistence/database')
    vi.spyOn(database, 'addDiagnostic').mockRejectedValue(new Error('storage gone'))
    vi.spyOn(database, 'loadDiagnostics').mockRejectedValue(new Error('storage gone'))

    await expect(record('error', 'k', 'm')).resolves.toBeUndefined()
    await expect(sendDiagnostics()).resolves.toBeUndefined()
    vi.restoreAllMocks()
  })
})

describe('sending diagnostics', () => {
  let send: MockInstance<typeof api.sendDiagnostics>

  beforeEach(async () => {
    await clearBuffer()
    send = vi.spyOn(api, 'sendDiagnostics').mockResolvedValue(undefined)
    await record('info', 'sync', 'Sync started')
    await record('error', 'photo_upload', 'Photo upload failed (400)')
  })
  afterEach(() => vi.restoreAllMocks())

  it('sends the build that recorded an entry, not the one that sends it', async () => {
    await clearBuffer()
    const entry = createEntry('info', 'update', 'Update waiting')
    expect(entry.context.recorded_build).toBe(APP_BUILD)
    entry.context.recorded_build = 'older-build'
    await addDiagnostic(entry)

    await sendDiagnostics()

    expect(send.mock.calls[0]![0].entries[0]!.context.recorded_build).toBe('older-build')
  })

  it('deletes the entries after the server confirmed them', async () => {
    await sendDiagnostics()

    expect(send).toHaveBeenCalledTimes(1)
    const [report] = send.mock.calls[0]!
    expect(report.user_agent).toBe(navigator.userAgent)
    // Entries of the same millisecond have no fixed order.
    expect(report.entries.map((entry) => entry.kind).sort()).toEqual(['photo_upload', 'sync'])
    expect(await buffered()).toEqual([])
  })

  it('keeps the entries after a failure and does not record the failure itself', async () => {
    send.mockRejectedValue(new ApiError(500, 'Server Error'))
    await sendDiagnostics()
    await sendDiagnostics()

    expect(send).toHaveBeenCalledTimes(2)
    expect((await buffered()).map((entry) => [entry.kind, entry.count]).sort()).toEqual([
      ['photo_upload', 1],
      ['sync', 1],
    ])
  })

  it('waits for the next sign-in after a 401', async () => {
    send.mockRejectedValueOnce(new ApiError(401, 'Unknown or revoked invite link.'))
    await sendDiagnostics()
    await sendDiagnostics()
    expect(send).toHaveBeenCalledTimes(1)
    expect(await buffered()).toHaveLength(2)

    await sendDiagnostics({ afterSignIn: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(await buffered()).toEqual([])
  })

  it('sends at most 100 entries per request', async () => {
    await clearBuffer()
    for (let index = 0; index < 150; index++) {
      await record('info', 'k', `message ${index}`)
    }
    await sendDiagnostics()

    expect(send.mock.calls.map(([report]) => report.entries.length)).toEqual([100, 50])
    expect(await buffered()).toEqual([])
  })

  it('sends once more what was recorded while a send was running', async () => {
    let finish!: () => void
    send.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))),
    )
    const first = sendDiagnostics()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await record('error', 'late', 'recorded during the send')
    const second = sendDiagnostics()
    finish()
    await first
    await second
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[1]![0].entries.map((entry) => entry.kind)).toEqual(['late'])
    expect(await buffered()).toEqual([])
  })

  it('does nothing offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await sendDiagnostics()
    expect(send).not.toHaveBeenCalled()
  })

  it('asks for keepalive when the page goes away, with one request', async () => {
    await sendDiagnostics({ keepalive: true })
    expect(send).toHaveBeenCalledWith(expect.anything(), true)
  })

  it('sends one entry directly when there is no buffer', async () => {
    await reportWithoutBuffer('storage_unavailable', 'no storage')
    expect(send.mock.calls[send.mock.calls.length - 1]![0].entries).toMatchObject([
      { level: 'error', kind: 'storage_unavailable', message: 'no storage', count: 1 },
    ])
  })
})
