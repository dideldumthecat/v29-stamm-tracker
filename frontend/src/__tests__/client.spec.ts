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
