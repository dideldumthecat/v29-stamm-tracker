import { vi } from 'vitest'

/**
 * A stand-in for fetch that behaves like the three session endpoints.
 * `codes` maps an invite code to the role of its user; an unknown code is 401. `offline` makes every request fail.
 */
export function fakeApi(codes: Record<string, string>, { offline = false } = {}) {
  let role: string | null = null
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = `${init.method} ${url}`
      calls.push(call)
      if (offline) throw new TypeError('Failed to fetch')
      const json = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status })
      if (call === 'POST /api/session') {
        const granted = codes[JSON.parse(init.body as string).token]
        if (!granted) return json(401)
        role = granted
        return json(200, { user: { id: 'x', name: 'Ada' } })
      }
      if (call === 'DELETE /api/session') {
        role = null
        return json(204)
      }
      if (call === 'GET /api/admin/me') {
        if (!role) return json(401)
        if (role === 'user') return json(403)
        return json(200, { user: { id: 'x', name: 'Ada', role } })
      }
      return json(404)
    }),
  )
  return { calls, expireSession: () => (role = null) }
}
