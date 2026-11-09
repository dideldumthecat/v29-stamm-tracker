import { vi } from 'vitest'

import { activityAnswer } from './fakeActivity'
import { snapshotFixture } from './fakeSnapshot'

/**
 * A stand-in for fetch that behaves like the session endpoints and the activity list (see fakeActivity.ts).
 * `codes` maps an invite code to the role of its user; an unknown code is 401. `offline` makes every request fail.
 */
export function fakeApi(codes: Record<string, string>, { offline = false, pageSize = 50 } = {}) {
  let role: string | null = null
  let signOutFails = false
  let activityFails = false
  let snapshotFails = false
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
        if (signOutFails) return json(500)
        role = null
        return json(204)
      }
      if (call === 'GET /api/admin/me') {
        if (!role) return json(401)
        if (role === 'user') return json(403)
        return json(200, { user: { id: 'x', name: 'Ada', role } })
      }
      if (call.startsWith('GET /api/admin/activity')) {
        if (!role) return json(401)
        if (activityFails) return json(500)
        const query = new URL(url, 'http://localhost').searchParams
        const answer = activityAnswer(query, pageSize)
        return answer ? json(200, answer) : json(400)
      }
      if (call === 'GET /api/snapshot') {
        if (!role) return json(401)
        return snapshotFails ? json(500) : json(200, snapshotFixture)
      }
      return json(404)
    }),
  )
  return {
    calls,
    expireSession: () => (role = null),
    failSignOut: () => (signOutFails = true),
    failActivity: (fails = true) => (activityFails = fails),
    failSnapshot: (fails = true) => (snapshotFails = fails),
  }
}
