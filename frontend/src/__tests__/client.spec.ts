import { afterEach, describe, expect, it, vi } from 'vitest'

describe('real API client', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('sends the app build with every request', async () => {
    vi.stubEnv('VITE_API', '')
    const fetchMock = vi.fn(async () => Response.json({ accepted_event_ids: [], rejected: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = await import('@/api/client')

    await api.sync([])
    await api.loadSnapshot()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)['X-App-Build']).toMatch(
        /^\S* ?\d{4}-\d\d-\d\dT\d\d:\d\d$/,
      )
    }
  })
})

describe('failed requests in the diagnostics', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  // Recording is fire-and-forget, so wait until the entry is in the buffer.
  async function entryNamed(message: string) {
    const { loadDiagnostics } = await import('@/persistence/database')
    return vi.waitFor(async () => {
      const entry = (await loadDiagnostics()).find((candidate) => candidate.message === message)
      expect(entry).toBeDefined()
      return entry!
    })
  }

  it('keeps the first 500 characters of an error response that is not JSON', async () => {
    vi.stubEnv('VITE_API', '')
    const html = '<!DOCTYPE html>' + 'x'.repeat(2000)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { status: 400 })),
    )
    const { api, ApiError } = await import('@/api/client')

    await expect(api.loadSnapshot()).rejects.toBeInstanceOf(ApiError)

    const entry = await entryNamed('GET /api/snapshot failed (400)')
    expect(entry).toMatchObject({ level: 'error', kind: 'request_failed' })
    expect(entry.context.body_start).toBe(html.slice(0, 500))
    expect(entry.context.path).toBe('/api/snapshot')
    expect(typeof entry.context.duration_ms).toBe('number')
  })

  it('treats an answer from Symfony as a warning and a stop by the user as info', async () => {
    vi.stubEnv('VITE_API', '')
    const fetchMock = vi.fn(async () => Response.json({ detail: 'nope' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = await import('@/api/client')
    await expect(api.sync([])).rejects.toThrow('nope')
    const unauthorized = await entryNamed('POST /api/sync failed (401)')
    expect(unauthorized.level).toBe('warning')
    expect(unauthorized.context).not.toHaveProperty('body_start')

    fetchMock.mockRejectedValue(new TypeError('Load failed'))
    const controller = new AbortController()
    controller.abort()
    await expect(api.sync([], controller.signal)).rejects.toThrow()
    expect((await entryNamed('POST /api/sync failed (stopped)')).level).toBe('info')

    await expect(
      api.sync([], AbortSignal.abort(new DOMException('t', 'TimeoutError'))),
    ).rejects.toThrow()
    expect((await entryNamed('POST /api/sync failed (timeout)')).level).toBe('warning')
  })

  it('does not record a failing diagnostics report', async () => {
    vi.stubEnv('VITE_API', '')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    )
    const { api } = await import('@/api/client')
    const { loadDiagnostics } = await import('@/persistence/database')
    const before = (await loadDiagnostics()).length

    await expect(api.sendDiagnostics({ user_agent: 'x', entries: [] })).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await loadDiagnostics()).toHaveLength(before)
  })

  it('sends the report with keepalive when asked to', async () => {
    vi.stubEnv('VITE_API', '')
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { api } = await import('@/api/client')

    await expect(
      api.sendDiagnostics({ user_agent: 'x', entries: [] }, true),
    ).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect([url, init.keepalive]).toEqual(['/api/diagnostics', true])
  })
})
