import { describe, it, expect } from 'vitest'
import type { Event, Snapshot, TimberItem } from '@v29/shared/contract'
import snapshotFixture from '@v29/shared/fixtures/snapshot.json'
import {
  childrenOf,
  isInherited,
  nextBeamTagOf,
  projectItems,
  removedBeams,
  withInherited,
} from '@/stores/projection'

// Fixture: stem 789 with Holzart, Lieferdatum, Gesägt; beam 789-A inherits Holzart and Lieferdatum,
// beam 789-B inherits Holzart but has its own Lieferdatum.
const fixture = () => structuredClone(snapshotFixture) as unknown as Snapshot
const attributeId = (snapshot: Snapshot, name: string) =>
  snapshot.attributes.find((attribute) => attribute.name === name)!.id
const byTag = (items: TimberItem[], tag: string) => items.find((item) => item.tag_number === tag)!

let sequence = 0
function event<T extends Event['type']>(
  type: T,
  timberItemId: string,
  data: Extract<Event, { type: T }>['data'],
): Event {
  return {
    id: `event-${++sequence}`,
    schema_version: 1,
    type,
    timber_item_id: timberItemId,
    recorded_at: '2026-11-07T08:00:00.000Z',
    data,
  } as Event
}

describe('projection', () => {
  it('strips inherited values from beams, keeps own ones and leaves the snapshot untouched', () => {
    const snapshot = fixture()
    const before = structuredClone(snapshot)
    const items = projectItems(snapshot, [], snapshot.attributes, 'me')

    expect(Object.keys(byTag(items, '789-A').values)).toEqual([
      attributeId(snapshot, 'Sortierklasse'),
    ])
    expect(byTag(items, '789-B').values[attributeId(snapshot, 'Lieferdatum')]).toBeDefined()
    expect(snapshot).toEqual(before)
  })

  it('lays pending events over the snapshot, as the current user', () => {
    const snapshot = fixture()
    const sortierklasse = attributeId(snapshot, 'Sortierklasse')
    const holzfeuchte = attributeId(snapshot, 'Holzfeuchte')
    const stem = byTag(snapshot.timber_items, '123')
    const events = [
      event('created', 'new', { parent_id: null }),
      event('tag_assigned', 'new', { tag_number: '5' }),
      event('attribute_recorded', 'new', { attribute_id: sortierklasse, value: 'a' }),
      event('attribute_recorded', 'new', { attribute_id: sortierklasse, value: 'b' }),
      event('attribute_recorded', stem.id, { attribute_id: holzfeuchte, value: 40 }),
      event('attribute_recorded', 'unknown', { attribute_id: sortierklasse, value: 'x' }),
    ]
    const items = projectItems(snapshot, events, snapshot.attributes, 'me')

    const created = byTag(items, '5')
    expect(created).toMatchObject({ parent_id: null, has_children: false, created_by: 'me' })
    // Not a series: the last recording replaces the earlier one.
    expect(created.values[sortierklasse]!.map((record) => record.value)).toEqual(['b'])
    expect(created.values[sortierklasse]![0]!.user_id).toBe('me')
    // A series keeps every recording.
    expect(byTag(items, '123').values[holzfeuchte]!.map((record) => record.value)).toEqual([
      ...stem.values[holzfeuchte]!.map((record) => record.value),
      40,
    ])
    expect(items.find((item) => item.id === 'unknown')).toBeUndefined()
  })

  it('locks a stem with a new beam and unlocks it when its last beam is removed', () => {
    const snapshot = fixture()
    const stem123 = byTag(snapshot.timber_items, '123')
    const withBeam = projectItems(
      snapshot,
      [event('created', 'beam', { parent_id: stem123.id })],
      snapshot.attributes,
      'me',
    )
    expect(byTag(withBeam, '123').has_children).toBe(true)

    const beamA = byTag(snapshot.timber_items, '789-A')
    const beamB = byTag(snapshot.timber_items, '789-B')
    const oneRemoved = projectItems(
      snapshot,
      [event('voided', beamA.id, {})],
      snapshot.attributes,
      'me',
    )
    expect(oneRemoved.find((item) => item.id === beamA.id)).toBeUndefined()
    expect(byTag(oneRemoved, '789').has_children).toBe(true)

    const bothRemoved = projectItems(
      snapshot,
      [event('voided', beamA.id, {}), event('voided', beamB.id, {})],
      snapshot.attributes,
      'me',
    )
    expect(byTag(bothRemoved, '789').has_children).toBe(false)
  })

  it('names removed synced beams as the snapshot holds them', () => {
    const snapshot = fixture()
    const beam = byTag(snapshot.timber_items, '789-A')
    const removed = removedBeams(snapshot, [
      event('voided', beam.id, {}),
      event('voided', 'not-synced', {}),
    ])
    expect([...removed.keys()]).toEqual([beam.id])
    expect(removed.get(beam.id)!.tag_number).toBe('789-A')
  })

  it('adds inheritable parent values unless the beam has its own, and tells which are inherited', () => {
    const snapshot = fixture()
    const items = projectItems(snapshot, [], snapshot.attributes, 'me')
    const holzart = attributeId(snapshot, 'Holzart')
    const lieferdatum = attributeId(snapshot, 'Lieferdatum')
    const lagerplatz = attributeId(snapshot, 'Lagerplatz')
    const stem = byTag(items, '789')
    const beamA = byTag(items, '789-A')
    const beamB = byTag(items, '789-B')

    expect(withInherited(beamA, items, snapshot.attributes).values[holzart]).toEqual(
      stem.values[holzart],
    )
    expect(isInherited(beamA.id, holzart, items, snapshot.attributes)).toBe(true)
    expect(isInherited(beamB.id, lieferdatum, items, snapshot.attributes)).toBe(false)
    expect(withInherited(stem, items, snapshot.attributes)).toBe(stem)

    // Not inheritable: stays on the parent.
    const parentWithLagerplatz = projectItems(
      snapshot,
      [
        event('created', 'stem', { parent_id: null }),
        event('attribute_recorded', 'stem', { attribute_id: lagerplatz, value: 'x' }),
        event('created', 'beam', { parent_id: 'stem' }),
      ],
      snapshot.attributes,
      'me',
    )
    const newBeam = parentWithLagerplatz.find((item) => item.id === 'beam')!
    expect(
      withInherited(newBeam, parentWithLagerplatz, snapshot.attributes).values[lagerplatz],
    ).toBeUndefined()
  })

  it('takes an inherited series as a whole list; an own recording replaces it', () => {
    const snapshot = fixture()
    const series = snapshot.attributes.find((attribute) => attribute.is_series)!
    series.is_inheritable = true
    const recorded = [
      event('created', 'stem', { parent_id: null }),
      event('attribute_recorded', 'stem', { attribute_id: series.id, value: 40 }),
      event('attribute_recorded', 'stem', { attribute_id: series.id, value: 41 }),
      event('created', 'beam', { parent_id: 'stem' }),
    ]
    const values = (events: Event[]) => {
      const items = projectItems(snapshot, events, snapshot.attributes, 'me')
      const beam = items.find((item) => item.id === 'beam')!
      return withInherited(beam, items, snapshot.attributes).values[series.id]!.map(
        (record) => record.value,
      )
    }
    expect(values(recorded)).toEqual([40, 41])
    expect(
      values([
        ...recorded,
        event('attribute_recorded', 'beam', { attribute_id: series.id, value: 30 }),
      ]),
    ).toEqual([30])
  })

  it('sorts beams by tag, untagged last, whatever order they arrived in', () => {
    const snapshot = fixture()
    snapshot.timber_items.reverse()
    const stem = byTag(snapshot.timber_items, '789')
    const items = projectItems(
      snapshot,
      [event('created', 'untagged', { parent_id: stem.id })],
      snapshot.attributes,
      'me',
    )
    expect(childrenOf(stem.id, items, snapshot.attributes).map((beam) => beam.tag_number)).toEqual([
      '789-A',
      '789-B',
      null,
    ])
  })

  it('hands out the next free beam letter, counting draft beams and freeing removed ones', () => {
    const snapshot = fixture()
    const items = projectItems(snapshot, [], snapshot.attributes, 'me')
    const stem = byTag(items, '789')
    expect(nextBeamTagOf(stem, '789', items)).toBe('789-C')
    expect(nextBeamTagOf(stem, '789', items, ['789-C'])).toBe('789-D')
    expect(nextBeamTagOf(undefined, '5', items)).toBe('5-A')

    const withoutA = projectItems(
      snapshot,
      [event('voided', byTag(items, '789-A').id, {})],
      snapshot.attributes,
      'me',
    )
    expect(nextBeamTagOf(stem, '789', withoutA)).toBe('789-A')
  })
})
