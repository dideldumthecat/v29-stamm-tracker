import type { AdminPile, AdminPileInput } from '../api/contract'

import fixture from '@v29/shared/fixtures/admin-piles-response.json' with { type: 'json' }

/**
 * Stands in for /api/admin/piles, with state: the piles of the fixture. Derives the label like the server and checks only that the number is there:
 * `reject` makes the next POST or PATCH answer 422 with the errors given (the rules live in the backend).
 * Used by the unit tests (fakeApi.ts) and the browser tests.
 */
export function createFakePiles() {
  let piles = structuredClone(fixture.piles) as AdminPile[]
  let rejection: { field: string; message: string }[] | null = null
  let counter = 0

  return {
    piles: () => piles,
    reject: (errors: { field: string; message: string }[]) => (rejection = errors),
    /** null: not a piles call. */
    handle(method: string, path: string, body: unknown): { status: number; json?: unknown } | null {
      const match = /^\/api\/admin\/piles(?:\/([^/]+))?$/.exec(path)
      if (!match) return null
      const id = match[1]
      const input = (body ?? {}) as Partial<AdminPileInput>
      if (method === 'GET' && !id) return { status: 200, json: { piles: piles } }
      if (rejection && (method === 'POST' || method === 'PATCH')) {
        const errors = rejection
        rejection = null
        return { status: 422, json: { errors } }
      }
      const merge = (base: AdminPile): AdminPile => {
        const next = { ...base, ...input } as AdminPile
        // the server's rule, spelled out here because the browser tests cannot resolve the '@/' alias
        next.label = next.location ? `${next.number} (${next.location})` : (next.number ?? '')
        return next
      }
      // The one rule it knows, because the form has to show it: the number is required
      const noNumber = (pile: AdminPile) =>
        pile.number?.trim()
          ? null
          : {
              status: 422,
              json: { errors: [{ field: 'number', message: 'Bitte eine Nummer eingeben.' }] },
            }
      if (method === 'POST' && !id) {
        const created = merge({
          id: `new-pile-${++counter}`,
          label: '',
          number: null,
          location: null,
          latitude: null,
          longitude: null,
          stacked_volume: null,
        })
        if (noNumber(created)) return noNumber(created)
        piles = [...piles, created]
        return { status: 201, json: created }
      }
      const current = piles.find((pile) => pile.id === id)
      if (method !== 'PATCH' || !current) return { status: 404 }
      const next = merge(current)
      if (noNumber(next)) return noNumber(next)
      piles = piles.map((pile) => (pile.id === id ? next : pile))
      return { status: 200, json: next }
    },
  }
}
