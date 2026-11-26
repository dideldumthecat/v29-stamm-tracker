import type { AttributeValueRecord, Snapshot, TimberItem } from '@v29/shared/contract'
import fixture from '@v29/shared/fixtures/snapshot.json' with { type: 'json' }

import { activityFixture } from './fakeActivity'

const base = fixture as unknown as Snapshot
const attribute = (name: string) => base.attributes.find((candidate) => candidate.name === name)!
const option = (name: string, label: string) =>
  attribute(name).options.find((candidate) => candidate.label === label)!.id
const alex = base.users.find((user) => user.name === 'Alex Beispiel')!.id

let counter = 0
const record = (value: AttributeValueRecord['value'], recorded_at: string) => ({
  value,
  recorded_at,
  user_id: alex,
  event_id: `e-${++counter}`,
})

// Further stems for the list: one without values, one with others, one without a tag
const otherStem = (tag: string | null, values: TimberItem['values']): TimberItem => ({
  id: `stem-${tag ?? 'none'}`,
  parent_id: null,
  tag_number: tag,
  has_children: false,
  created_at: '2026-10-20T08:00:00.000Z',
  created_by: alex,
  values,
})

/** The shared snapshot, reduced to stem 104 with the beams A to C (they match the activity fixture of the 31 October) and the users of that fixture,
 *  plus the stems 7 (nothing recorded), 1500 and one without a tag, which only the lists of the administration need.
 *  The other items of the shared snapshot (123, 456, 789) are left out: the tests of the administration count stems, beams and attributes with values. */
export const snapshotFixture: Snapshot = {
  ...base,
  users: activityFixture.users,
  timber_items: [
    ...base.timber_items.filter((item) => item.tag_number?.startsWith('104')),
    otherStem('7', {}),
    otherStem('1500', {
      [attribute('Holzart').id]: [
        record(option('Holzart', 'Traubeneiche'), '2025-12-30T09:00:00.000Z'),
      ],
      [attribute('Fälldatum').id]: [record('2025-12', '2025-12-30T09:01:00.000Z')],
      [attribute('Gesägt').id]: [record(false, '2025-12-30T09:02:00.000Z')],
      [attribute('Holzfeuchte').id]: [record(30, '2025-12-30T09:03:00.000Z')],
    }),
    otherStem(null, {
      [attribute('Notiz').id]: [record('Plakette fehlt', '2026-10-21T08:00:00.000Z')],
    }),
  ],
}

/** Day and time of the stem's photos as the gallery shows them (the first by its capture time, the second by its recording; it lies on the 31st in Berlin, on the 30th in UTC). */
export const stemPhotoDays = ['27.10.2026, 15:05', '31.10.2026, 00:30']

/** Photo ids of the stem, the first of them is uploaded, the second is not. */
export const stemPhotos = [
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a2',
]
