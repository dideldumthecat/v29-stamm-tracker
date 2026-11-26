import type { AdminAttribute, AdminAttributeInput } from '../api/contract'

import { snapshotFixture } from './fakeSnapshot'

/**
 * Stands in for /api/admin/attributes, with state: the attributes of the snapshot fixture, a key makes one a system attribute,
 * a value on any item gives `has_values`. Checks nothing itself: `reject` makes the next PATCH or POST answer 422 with the errors given
 * (the rules live in the backend). Used by the unit tests (fakeApi.ts) and the browser tests.
 */
export function createFakeAttributes() {
  let attributes: AdminAttribute[] = structuredClone(snapshotFixture.attributes).map(
    (attribute) => ({
      ...attribute,
      is_system: attribute.key !== null,
      has_values: snapshotFixture.timber_items.some((item) => attribute.id in item.values),
    }),
  )
  let rejection: { field: string; message: string }[] | null = null
  let orderFails = false
  let counter = 0
  const sorted = () => [...attributes].sort((a, b) => a.sort_order - b.sort_order)

  const options = (input: AdminAttributeInput['options']) =>
    input.map((option, index) => ({
      id: option.id ?? `new-option-${++counter}`,
      label: option.label.trim(),
      sort_order: 10 * (index + 1),
      active: option.active,
    }))

  return {
    get attributes() {
      return sorted()
    },
    failOrder: (fails = true) => (orderFails = fails),
    reject: (errors: { field: string; message: string }[]) => (rejection = errors),
    /** null: not an attributes call. */
    handle(method: string, path: string, body: unknown): { status: number; json?: unknown } | null {
      const match = /^\/api\/admin\/attributes(?:\/([^/]+))?$/.exec(path)
      if (!match) return null
      const id = match[1]
      const input = body as AdminAttributeInput & { ids?: string[] }
      if (method === 'GET' && !id) return { status: 200, json: { attributes: sorted() } }
      if (method === 'PUT' && id === 'order') {
        if (orderFails) return { status: 500 }
        input.ids!.forEach((attributeId, index) => {
          attributes.find((attribute) => attribute.id === attributeId)!.sort_order =
            10 * (index + 1)
        })
        return { status: 200, json: { attributes: sorted() } }
      }
      if (method === 'POST' && !id) {
        if (rejection) return { status: 422, json: { errors: rejection } }
        const defaults: Partial<AdminAttributeInput> = {
          description: '',
          unit: null,
          is_series: false,
          is_inheritable: false,
          applies_to: ['stem', 'beam'],
          hidden_when: [],
          active: true,
        }
        const created = {
          id: `new-attribute-${++counter}`,
          key: null,
          ...defaults,
          ...input,
          sort_order: Math.max(0, ...attributes.map((attribute) => attribute.sort_order)) + 10,
          options: options(input.options ?? []),
          is_system: false,
          has_values: false,
        } as AdminAttribute
        attributes = [...attributes, created]
        return { status: 201, json: created }
      }
      if (method === 'PATCH' && id) {
        const current = attributes.find((attribute) => attribute.id === id)
        if (!current) return { status: 404 }
        if (rejection) return { status: 422, json: { errors: rejection } }
        // A system attribute takes only name and description (the server refuses the rest)
        const allowed = current.is_system
          ? { name: input.name, description: input.description }
          : input
        const next: AdminAttribute = {
          ...current,
          ...allowed,
          options: input.options && !current.is_system ? options(input.options) : current.options,
        }
        attributes = attributes.map((attribute) => (attribute.id === id ? next : attribute))
        return { status: 200, json: next }
      }
      return { status: 404 }
    },
  }
}
