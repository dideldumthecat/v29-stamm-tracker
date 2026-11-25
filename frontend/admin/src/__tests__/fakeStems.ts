import type { Attribute, Snapshot, TimberItem } from '@v29/shared/contract'

import { snapshotFixture } from './fakeSnapshot'

const attribute = (key: string, type: Attribute['type'], sort_order: number): Attribute => ({
  id: `a-${key}`,
  key,
  name: `Name von ${key}`,
  description: '',
  type,
  unit: null,
  is_series: false,
  is_inheritable: false,
  applies_to: ['stem'],
  hidden_when: [],
  sort_order,
  active: true,
  options: [],
})

/** The attributes the diameter class and "Bearbeitet" are read from, found by key only (their names say nothing). */
export const processingAttributes: Attribute[] = [
  attribute('mid_diameter_max', 'number', 1),
  attribute('mid_diameter_min', 'number', 2),
  attribute('sawn', 'boolean', 3),
  attribute('unsawable', 'boolean', 4),
  attribute('sawn_cross_section', 'text', 5),
]

export interface StemSpec {
  max?: number
  min?: number
  sawn?: boolean
  unsawable?: boolean
  crossSection?: string
}

const KEYS = {
  max: 'mid_diameter_max',
  min: 'mid_diameter_min',
  sawn: 'sawn',
  unsawable: 'unsawable',
  crossSection: 'sawn_cross_section',
} as const

/** A stem with the given values and `beams` beams (own, without values), as the snapshot has them. */
export function stemWithBeams(tag: string, spec: StemSpec = {}, beams = 0): TimberItem[] {
  const values: TimberItem['values'] = {}
  for (const [field, key] of Object.entries(KEYS)) {
    const value = spec[field as keyof StemSpec]
    if (value !== undefined)
      values[`a-${key}`] = [
        {
          value,
          recorded_at: '2026-10-31T10:00:00.000Z',
          user_id: 'u',
          event_id: `e-${tag}-${key}`,
        },
      ]
  }
  const item = (
    id: string,
    parent: string | null,
    itemValues: TimberItem['values'],
  ): TimberItem => ({
    id,
    parent_id: parent,
    tag_number: id.replace('stem-', ''),
    has_children: !parent && beams > 0,
    created_at: '2026-10-20T08:00:00.000Z',
    created_by: snapshotFixture.users[0].id,
    values: itemValues,
  })
  return [
    item(`stem-${tag}`, null, values),
    ...Array.from({ length: beams }, (_, index) =>
      item(`stem-${tag}-${String.fromCharCode(65 + index)}`, `stem-${tag}`, {}),
    ),
  ]
}

export const stem = (tag: string, spec: StemSpec = {}, beams = 0): TimberItem =>
  stemWithBeams(tag, spec, beams)[0]

export const processingSnapshot = (items: TimberItem[]): Snapshot => ({
  ...snapshotFixture,
  attributes: processingAttributes,
  timber_items: items,
})
