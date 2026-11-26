import type { AdminGroup } from '../api/contract'

import listFixture from '@v29/shared/fixtures/admin-groups-response.json' with { type: 'json' }

/**
 * Stands in for /api/admin/groups, with state: the groups of the fixture. Checks almost nothing itself (the rules live in the backend):
 * `reject` makes the next POST or PATCH answer 422 with the errors given, and a group with users is not deleted (409), as on the server.
 * Used by the unit tests (fakeApi.ts) and the browser tests.
 */
export function createFakeGroups() {
  let groups = structuredClone(listFixture.groups) as AdminGroup[]
  let rejection: { field: string; message: string }[] | null = null
  let counter = 0
  const sorted = () => [...groups].sort((a, b) => a.name.localeCompare(b.name, 'de'))

  return {
    get groups() {
      return sorted()
    },
    /** The next POST or PATCH answers 422 with these errors. */
    reject: (errors: { field: string; message: string }[]) => (rejection = errors),
    /** null: not a groups call. */
    handle(method: string, path: string, body: Record<string, unknown> | undefined) {
      const match = /^\/api\/admin\/groups(?:\/([^/]+))?$/.exec(path)
      if (!match) return null
      const id = match[1]
      const group = groups.find((entry) => entry.id === id)
      if (method === 'GET' && !id) return { status: 200, json: { groups: sorted() } }
      if (rejection && (method === 'POST' || method === 'PATCH')) {
        const errors = rejection
        rejection = null
        return { status: 422, json: { errors } }
      }
      if (method === 'POST' && !id) {
        const created: AdminGroup = {
          id: `new-group-${++counter}`,
          name: String(body?.name).trim(),
          sees_all_attributes: body?.sees_all_attributes === true,
          attribute_ids: (body?.attribute_ids as string[] | undefined) ?? [],
          users: [],
        }
        groups = [...groups, created]
        return { status: 201, json: created }
      }
      if (!group) return { status: 404 }
      if (method === 'DELETE') {
        if (group.users.length > 0) return { status: 409 }
        groups = groups.filter((entry) => entry.id !== group.id)
        return { status: 204 }
      }
      if (method === 'PATCH') {
        const next: AdminGroup = {
          ...group,
          name: typeof body?.name === 'string' ? body.name.trim() : group.name,
          sees_all_attributes:
            typeof body?.sees_all_attributes === 'boolean'
              ? body.sees_all_attributes
              : group.sees_all_attributes,
          attribute_ids: (body?.attribute_ids as string[] | undefined) ?? group.attribute_ids,
        }
        if (next.sees_all_attributes) next.attribute_ids = []
        groups = groups.map((entry) => (entry.id === group.id ? next : entry))
        return { status: 200, json: next }
      }
      return { status: 404 }
    },
  }
}
