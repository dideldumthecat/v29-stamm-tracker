import type { AdminInviteResponse, AdminUser, AdminUsersResponse } from '@v29/shared/contract'

import listFixture from '@v29/shared/fixtures/admin-users-response.json' with { type: 'json' }

/**
 * Stands in for /api/admin/users, with state: the users of the fixture (seen by the superadmin Ada, the administrator is Chef). The flags
 * (`can_manage` …) follow the rules of the server in a few lines, because what the page shows depends on them; nothing else is checked.
 * Codes are made up ("N1AA-…"); `renewed` lists the users whose code was renewed. Used by the unit tests (fakeApi.ts) and the browser tests.
 */
export function createFakeUsers() {
  let users = structuredClone(listFixture.users) as AdminUser[]
  const renewed: string[] = []
  let counter = 0
  let codeCounter = 0
  let rejection: { field: string; message: string }[] | null = null

  const me = (role: string) => users.find((user) => user.role === role)!
  const view = (user: AdminUser, role: string): AdminUser => {
    const manage =
      user.role === 'user' ||
      (role === 'superadmin' && user.role === 'admin' && user.id !== me(role).id)
    return {
      ...user,
      can_manage: manage,
      can_block: manage && user.id !== me(role).id,
      can_set_role: role === 'superadmin' && user.role !== 'superadmin',
    }
  }
  const invite = (user: AdminUser, role: string, code: string): AdminInviteResponse => ({
    user: view(user, role),
    invite: { code },
  })
  const newCode = () => `N${++codeCounter}AA-BBBB-CCCC`

  return {
    users: () => users,
    renewed,
    /** The next POST or PATCH answers 422 with these errors. */
    reject: (errors: { field: string; message: string }[]) => (rejection = errors),
    handle(method: string, path: string, body: Record<string, unknown> | undefined, role: string) {
      const match = /^\/api\/admin\/users(?:\/([^/]+)(\/invite)?)?$/.exec(path)
      if (!match) return null
      const [, id, isInvite] = match
      const user = users.find((entry) => entry.id === id)
      if (method === 'GET' && !id) {
        return {
          status: 200,
          json: {
            users: users.map((entry) => view(entry, role)),
            creatable_roles: role === 'superadmin' ? ['user', 'admin'] : ['user'],
          } satisfies AdminUsersResponse,
        }
      }
      if (rejection && (method === 'POST' || method === 'PATCH') && !isInvite) {
        const errors = rejection
        rejection = null
        return { status: 422, json: { errors } }
      }
      if (method === 'POST' && !id) {
        const created: AdminUser = {
          id: `new-user-${++counter}`,
          name: String(body?.name).trim(),
          role: body?.role as AdminUser['role'],
          created_at: '2026-11-19T10:00:00.000Z',
          revoked_at: null,
          last_active_at: null,
          can_manage: true,
          can_block: true,
          can_set_role: false,
        }
        users = [...users, created]
        return { status: 201, json: invite(created, role, newCode()) }
      }
      if (!user) return { status: 404 }
      if (isInvite && method === 'POST') {
        if (user.revoked_at) return { status: 409 }
        renewed.push(user.name)
        return { status: 200, json: invite(user, role, newCode()) }
      }
      if (method === 'PATCH') {
        const next = { ...user }
        if (typeof body?.name === 'string') next.name = body.name.trim()
        if (typeof body?.role === 'string') next.role = body.role as AdminUser['role']
        if (typeof body?.blocked === 'boolean') {
          next.revoked_at = body.blocked ? (user.revoked_at ?? '2026-11-19T10:00:00.000Z') : null
        }
        users = users.map((entry) => (entry.id === user.id ? next : entry))
        return { status: 200, json: { user: view(next, role) } }
      }
      return { status: 404 }
    },
  }
}
