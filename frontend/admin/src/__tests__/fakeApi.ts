import { vi } from 'vitest'
import type { DashboardResponse, Snapshot } from '@v29/shared/contract'

import dashboardFixture from '@v29/shared/fixtures/dashboard-response.json' with { type: 'json' }
import keyFiguresFixture from '@v29/shared/fixtures/key-figures-response.json' with { type: 'json' }

import { activityAnswer } from './fakeActivity'
import { createFakeAttributes } from './fakeAttributes'
import { createFakeUsers } from './fakeUsers'
import { snapshotFixture } from './fakeSnapshot'

/**
 * A stand-in for fetch that behaves like the session endpoints, the activity list (see fakeActivity.ts) and the key figures
 * (always the fixture of the worked example, whatever the item), the dashboard (its fixture), and the attributes (see fakeAttributes.ts).
 * `codes` maps an invite code to the role of its user; an unknown code is 401. `offline` makes every request fail.
 */
export function fakeApi(codes: Record<string, string>, { offline = false, pageSize = 50 } = {}) {
  let role: string | null = null
  let signOutFails = false
  let activityFails = false
  let snapshotFails = false
  let keyFiguresFail = false
  let dashboardFails = false
  let dashboard = dashboardFixture as DashboardResponse
  let snapshot: Snapshot = snapshotFixture
  const attributes = createFakeAttributes()
  const users = createFakeUsers()
  let usersFail = false
  let attributesFail = false
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
        return snapshotFails ? json(500) : json(200, snapshot)
      }
      if (/^GET \/api\/admin\/timber-items\/[^/]+\/key-figures$/.test(call)) {
        if (!role) return json(401)
        return keyFiguresFail ? json(500) : json(200, keyFiguresFixture)
      }
      if (call === 'GET /api/admin/dashboard') {
        if (!role) return json(401)
        return dashboardFails ? json(500) : json(200, dashboard)
      }
      if (url.startsWith('/api/admin/attributes')) {
        if (!role) return json(401)
        if (attributesFail) return json(500)
        const body = init.body ? JSON.parse(init.body as string) : undefined
        const answer = attributes.handle(init.method!, url, body)
        if (answer) return json(answer.status, answer.json)
      }
      if (url.startsWith('/api/admin/users')) {
        if (!role) return json(401)
        if (usersFail) return json(500)
        const body = init.body ? JSON.parse(init.body as string) : undefined
        const answer = users.handle(init.method!, url, body, role)
        if (answer) return json(answer.status, answer.json)
      }
      return json(404)
    }),
  )
  return {
    calls,
    setOffline: (down: boolean) => (offline = down),
    expireSession: () => (role = null),
    failSignOut: () => (signOutFails = true),
    failActivity: (fails = true) => (activityFails = fails),
    failSnapshot: (fails = true) => (snapshotFails = fails),
    setSnapshot: (next: Snapshot) => (snapshot = next),
    failKeyFigures: (fails = true) => (keyFiguresFail = fails),
    failDashboard: (fails = true) => (dashboardFails = fails),
    setDashboard: (next: DashboardResponse) => (dashboard = next),
    failAttributes: (fails = true) => (attributesFail = fails),
    failUsers: (fails = true) => (usersFail = fails),
    attributes,
    users,
  }
}
