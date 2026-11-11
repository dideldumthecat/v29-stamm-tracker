import type { AttributeValueRecord, Snapshot, TimberItem } from '@v29/shared/contract'
import fixture from '@v29/shared/fixtures/snapshot.json' with { type: 'json' }

import { activityFixture } from './fakeActivity'

const base = fixture as unknown as Snapshot
const attribute = (name: string) => base.attributes.find((candidate) => candidate.name === name)!
const option = (name: string, label: string) =>
  attribute(name).options.find((candidate) => candidate.label === label)!.id
// The items of stem 104 and its beams, with the ids the activity fixture uses
const itemId = (label: string) =>
  activityFixture.entries.flatMap((entry) => entry.items).find((item) => item.label === label)!
    .timber_item_id

const barina = activityFixture.users.find((user) => user.name === 'Alexander Barina')!.id
const summa = activityFixture.users.find((user) => user.name === 'Alexander Summa')!.id

let counter = 0
const record = (value: AttributeValueRecord['value'], recorded_at: string, user_id = summa) => ({
  value,
  recorded_at,
  user_id,
  event_id: `e-${++counter}`,
})

const holzart = record(option('Holzart', 'Stieleiche'), '2026-10-29T10:09:00.000Z')
const faelldatum = record('2026-10', '2026-10-29T10:10:00.000Z')
const gesaegt = record(true, '2026-10-31T10:46:00.000Z', barina)

const stem: TimberItem = {
  id: itemId('104'),
  parent_id: null,
  tag_number: '104',
  has_children: true,
  created_at: '2026-10-29T10:09:00.000Z',
  created_by: summa,
  values: {
    [attribute('Holzart').id]: [holzart],
    [attribute('Fälldatum').id]: [faelldatum],
    [attribute('Gesägt').id]: [gesaegt],
    [attribute('Holzfeuchte').id]: [
      record(48.5, '2026-10-29T10:12:00.000Z'),
      record(41, '2026-10-31T10:30:00.000Z', barina),
    ],
    [attribute('Notiz').id]: [
      record('Leichter Drehwuchs', '2026-10-29T10:13:00.000Z'),
      record('Zweite Zeile\nmit Umbruch', '2026-10-31T10:50:00.000Z', barina),
    ],
    [attribute('Fotos').id]: [
      record('00000000-0000-4000-8000-0000000000a1', '2026-10-29T10:14:00.000Z'),
      record('00000000-0000-4000-8000-0000000000a2', '2026-10-30T23:30:00.000Z'),
    ],
  },
}

const inherited = {
  [attribute('Holzart').id]: [holzart],
  [attribute('Fälldatum').id]: [faelldatum],
  [attribute('Gesägt').id]: [gesaegt],
}
const beam = (letter: string, values: TimberItem['values']): TimberItem => ({
  id: itemId(`104-${letter}`),
  parent_id: stem.id,
  tag_number: `104-${letter}`,
  has_children: false,
  created_at: '2026-10-31T10:46:20.000Z',
  created_by: barina,
  values: { ...inherited, ...values },
})

// Further stems for the list: one without values, one with others, one without a tag
const otherStem = (tag: string | null, values: TimberItem['values']): TimberItem => ({
  id: `stem-${tag ?? 'none'}`,
  parent_id: null,
  tag_number: tag,
  has_children: false,
  created_at: '2026-10-20T08:00:00.000Z',
  created_by: summa,
  values,
})

/** Stem 104 with the beams A to C and an inactive attribute without a value, matching the activity fixture of the 31 October.
 *  Beside it the stems 7 (nothing recorded), 1500 and one without a tag, for the list. */
export const snapshotFixture: Snapshot = {
  ...base,
  users: activityFixture.users,
  timber_items: [
    stem,
    beam('A', {
      [attribute('Fotos').id]: [
        record('00000000-0000-4000-8000-0000000000b1', '2026-10-31T10:46:40.000Z', barina),
      ],
    }),
    beam('B', {}),
    beam('C', {
      [attribute('Sortierklasse').id]: [
        record(option('Sortierklasse', 'B'), '2026-10-31T10:47:45.000Z', barina),
      ],
      [attribute('Notiz').id]: [record('105x145', '2026-10-31T10:47:50.000Z', barina)],
    }),
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

/** Day and time of the stem's photos as the gallery shows them (the second one lies on the 31st in Berlin, on the 30th in UTC). */
export const stemPhotoDays = ['29.10.2026, 11:14', '31.10.2026, 00:30']

/** Photo ids of the stem, the first of them is uploaded, the second is not. */
export const stemPhotos = [
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a2',
]
