import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import { api } from '@/api/client'
import { Blob as NodeBlob } from 'node:buffer'
import { save } from '@/persistence/database'

// Pass-through spy: tests can check what reaches IndexedDB.
vi.mock('@/persistence/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/persistence/database')>()
  return { ...original, save: vi.fn(original.save) }
})
// Pass-through spy: tests can check what the store reports to the diagnostics.
vi.mock('@/diagnostics/record', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/diagnostics/record')>()
  return { ...original, record: vi.fn(original.record) }
})
const cloneEverySave = () => structuredClone(vi.mocked(save).mock.calls)

// Fixture: stem 789 with Holzart, Lieferdatum, Gesägt; beam 789-A inherits Holzart and Lieferdatum,
// beam 789-B inherits Holzart but has its own Lieferdatum.
const attributeId = (name: string) =>
  useTimberItemStore().attributes.find((attribute) => attribute.name === name)!.id

describe('timber item store: beams and inheritance', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps only own values and adds inheritable parent values at read time', () => {
    const store = useTimberItemStore()
    const stored = store.items.find((item) => item.tag_number === '789-A')!
    expect(Object.keys(stored.values)).toEqual([attributeId('Sortierklasse')])

    const beam = store.findByTag('789-A')!
    expect(beam.values[attributeId('Holzart')]).toEqual(
      store.findByTag('789')!.values[attributeId('Holzart')],
    )
    expect(store.isInherited(beam.id, attributeId('Holzart'))).toBe(true)
    expect(store.isInherited(beam.id, attributeId('Sortierklasse'))).toBe(false)
  })

  it('lets an own value win and never inherits non-inheritable attributes', () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-B')!
    expect(beam.values[attributeId('Lieferdatum')]![0]!.value).toBe('2026-10-01')
    expect(store.isInherited(beam.id, attributeId('Lieferdatum'))).toBe(false)

    const stem = store.createTimberItem(5)
    store.recordAttribute(stem.id, attributeId('Lagerplatz'), 'any-option')
    const child = store.addBeam(stem.id)
    expect(store.findByTag(child.tag_number!)!.values[attributeId('Lagerplatz')]).toBeUndefined()
  })

  it('follows a parent value changed after the beam was added, until overwritten', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    const holzart = attributeId('Holzart')
    store.recordAttribute(stem.id, holzart, 'first')
    const beam = store.addBeam(stem.id)
    expect(store.findByTag('5-A')!.values[holzart]![0]!.value).toBe('first')
    // Holzart is for stems only, so the split stem still takes it.
    store.recordAttribute(stem.id, holzart, 'second')
    expect(store.findByTag('5-A')!.values[holzart]![0]!.value).toBe('second')
    expect(store.isInherited(beam.id, holzart)).toBe(true)

    store.recordAttribute(beam.id, holzart, 'own')
    expect(store.findByTag('5-A')!.values[holzart]!.map((record) => record.value)).toEqual(['own'])
    expect(store.isInherited(beam.id, holzart)).toBe(false)
  })

  it('records on a stem with beams only what beams do not take, and the notes', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addBeam(stem.id)
    const holzart = store.attributes.find((attribute) => attribute.name === 'Holzart')!.id
    const notes = store.attributes.find((attribute) => attribute.key === 'notes')!.id
    const sawn = store.attributes.find((attribute) => attribute.key === 'sawn')!.id
    expect(() => store.recordAttribute(stem.id, attributeId('Holzfeuchte'), 40)).toThrow(
      /read-only/,
    )
    expect(() => store.recordAttribute(stem.id, attributeId('Sortierklasse'), 'x')).toThrow(
      /read-only/,
    )
    expect(() => store.recordAttribute(stem.id, sawn, false)).toThrow(/read-only/)
    expect(() => store.addPhoto(stem.id, attributeId('Fotos'), new Blob())).toThrow(/read-only/)
    store.recordAttribute(stem.id, holzart, 'x')
    expect(store.findByTag('5')!.values[holzart]![0]!.value).toBe('x')
    store.recordAttribute(stem.id, notes, 'Krumm')
    expect(store.findByTag('5')!.values[notes]![0]!.value).toBe('Krumm')
  })

  it('takes an inherited series as a whole list; an own recording replaces it', () => {
    const store = useTimberItemStore()
    const series = store.attributes.find((attribute) => attribute.is_series)!
    series.is_inheritable = true
    const stem = store.createTimberItem(5)
    store.recordAttribute(stem.id, series.id, 40)
    store.recordAttribute(stem.id, series.id, 41)
    const beam = store.addBeam(stem.id)
    expect(store.findByTag('5-A')!.values[series.id]!.map((record) => record.value)).toEqual([
      40, 41,
    ])

    store.recordAttribute(beam.id, series.id, 30)
    expect(store.findByTag('5-A')!.values[series.id]!.map((record) => record.value)).toEqual([30])
  })

  it('lists the beams of a stem by tag, whatever order they arrived in', () => {
    const reversed = api.initialSnapshot()
    reversed.timber_items.reverse()
    vi.spyOn(api, 'initialSnapshot').mockReturnValueOnce(reversed)
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    expect(
      store.snapshot.timber_items.findIndex((item) => item.tag_number === '789-B'),
    ).toBeLessThan(store.snapshot.timber_items.findIndex((item) => item.tag_number === '789-A'))
    expect(store.childrenOf(stem.id).map((beam) => beam.tag_number)).toEqual(['789-A', '789-B'])
  })

  it('letters beams, locks the parent and removes beams but no stems', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    expect(store.addBeam(stem.id).tag_number).toBe('789-C')
    expect(() => store.recordAttribute(stem.id, attributeId('Lieferdatum'), '2026-10-02')).toThrow()

    expect(store.canRemove(store.findByTag('789-A')!.id)).toBe(true)
    expect(store.canRemove(stem.id)).toBe(false)

    const before = store.pendingCount
    const fresh = store.createTimberItem(6)
    const beam = store.addBeam(fresh.id)
    store.recordAttribute(beam.id, attributeId('Sortierklasse'), 'x')
    expect(store.canRemove(fresh.id)).toBe(false)
    store.removeTimberItem(beam.id)
    expect(store.findByTag('6-A')).toBeUndefined()
    expect(store.findByTag('6')!.has_children).toBe(false)
    // Only the stem's created event is left.
    expect(store.pendingCount).toBe(before + 1)

    // The removed beam's letter is free again.
    expect(store.addBeam(fresh.id).tag_number).toBe('6-A')
  })

  it('gives a new beam the first letter freed by a removed one', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(7)
    store.addBeam(stem.id)
    store.removeTimberItem(store.addBeam(stem.id).id)
    expect(store.addBeam(stem.id).tag_number).toBe('7-B')

    store.addBeam(stem.id)
    store.removeTimberItem(store.findByTag('7-B')!.id)
    expect(store.addBeam(stem.id).tag_number).toBe('7-B')
  })

  it('saves the queue after removing a beam in a form IndexedDB can store', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(6)
    store.removeTimberItem(store.addBeam(stem.id).id)
    expect(cloneEverySave).not.toThrow()
  })
})

describe('timber item store: beams in a draft', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('counts draft beams when handing out letters, so a letter shown once is never reused', () => {
    const store = useTimberItemStore()
    // A stem not saved yet has no beams of its own.
    expect(store.nextBeamTagOf(undefined, '9')).toBe('9-A')
    expect(store.nextBeamTagOf(undefined, '9', ['9-A'])).toBe('9-B')
    // A, B and C in the draft, A removed: B and C stay, the next beam takes the free A.
    expect(store.nextBeamTagOf(undefined, '9', ['9-B', '9-C'])).toBe('9-A')
    // Draft letters come on top of the saved beams.
    expect(store.nextBeamTagOf(store.findByTag('789'), '789', ['789-C'])).toBe('789-D')
  })

  it('saves a new stem, its values and its beams in one go; the beams inherit those values', () => {
    const store = useTimberItemStore()
    const holzart = attributeId('Holzart')
    store.inOneTransaction(() => {
      const stem = store.createTimberItem(9)
      store.recordAttribute(stem.id, holzart, 'oak')
      store.addBeam(stem.id, '9-A')
      store.addBeam(stem.id, '9-B')
    })

    expect(store.events.map((event) => event.type)).toEqual([
      'created',
      'tag_assigned',
      'attribute_recorded',
      'created',
      'tag_assigned',
      'created',
      'tag_assigned',
    ])
    expect(store.childrenOf(store.findByTag('9')!.id).map((beam) => beam.tag_number)).toEqual([
      '9-A',
      '9-B',
    ])
    expect(store.findByTag('9-B')!.values[holzart]![0]!.value).toBe('oak')
    expect(store.findByTag('9')!.has_children).toBe(true)
  })
})

describe('timber item store: removing synced beams', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  const jpeg = () => new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob
  const photoAttribute = () =>
    useTimberItemStore().attributes.find((attribute) => attribute.type === 'photo')!.id

  it('queues a voided event, hides the beam at once and frees its letter', () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    store.removeTimberItem(beam.id)

    expect(store.events.map((event) => [event.type, event.timber_item_id])).toEqual([
      ['voided', beam.id],
    ])
    expect(store.pendingCount).toBe(1)
    expect(store.findByTag('789-A')).toBeUndefined()
    expect(store.removedBeams.get(beam.id)?.tag_number).toBe('789-A')
    expect(store.nextBeamTagOf(store.findByTag('789'), '789')).toBe('789-A')
    expect(store.addBeam(store.findByTag('789')!.id).tag_number).toBe('789-A')
  })

  it('drops open values and photos of the beam, but keeps those of other items', () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-B')!
    const other = store.findByTag('789-A')!
    store.recordAttribute(beam.id, attributeId('Sortierklasse'), 'x')
    store.addPhoto(beam.id, photoAttribute(), jpeg())
    store.recordAttribute(other.id, attributeId('Sortierklasse'), 'y')
    store.addPhoto(other.id, photoAttribute(), jpeg())

    store.removeTimberItem(beam.id)
    expect(store.events.map((event) => [event.type, event.timber_item_id])).toEqual([
      ['attribute_recorded', other.id],
      ['attribute_recorded', other.id],
      ['voided', beam.id],
    ])
    expect(store.photos.map((photo) => photo.timber_item_id)).toEqual([other.id])
    expect(cloneEverySave).not.toThrow()
    // Leave no photo behind in the fake IndexedDB: later tests load from it.
    store.removePhoto(store.photos[0]!.id)
  })

  it('makes the stem editable again once its last beam is removed, also offline', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    store.removeTimberItem(store.findByTag('789-A')!.id)
    expect(store.findByTag('789')!.has_children).toBe(true)
    expect(() => store.recordAttribute(stem.id, attributeId('Lieferdatum'), '2026-10-02')).toThrow()

    store.removeTimberItem(store.findByTag('789-B')!.id)
    expect(store.findByTag('789')!.has_children).toBe(false)
    store.recordAttribute(stem.id, attributeId('Lieferdatum'), '2026-10-02')
  })

  it('brings the beam back with its data when the removal is discarded', () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    store.removeTimberItem(beam.id)
    store.discardEntry(store.events[0]!.id)

    expect(store.events).toEqual([])
    expect(store.findByTag('789-A')!.values).toEqual(beam.values)
    expect(store.removedBeams.size).toBe(0)
  })

  it('refuses to discard a removal once a new beam took the tag, and allows it after that beam is removed', () => {
    const store = useTimberItemStore()
    const stemId = store.findByTag('789')!.id
    const old = store.findByTag('789-B')!
    store.removeTimberItem(old.id)
    const removal = store.events[0]!
    expect(store.tagTakenOver(removal)).toBeNull()

    const fresh = store.addBeam(stemId)
    expect(fresh.tag_number).toBe('789-B')
    expect(store.tagTakenOver(removal)).toBe('789-B')
    expect(() => store.discardEntry(removal.id)).toThrow()
    expect(store.events).toContainEqual(removal)

    store.removeTimberItem(fresh.id)
    store.discardEntry(removal.id)
    expect(store.findByTag('789-B')!.id).toBe(old.id)
  })

  it('leaves the queue after the sync and the beam stays gone with the new snapshot', async () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-B')!
    store.removeTimberItem(beam.id)
    vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    const fresh = api.initialSnapshot()
    fresh.timber_items = fresh.timber_items.filter((item) => item.id !== beam.id)
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    expect(await store.sync()).toEqual({ transferred: 1, rejected: [] })
    expect(store.events).toEqual([])
    expect(store.findByTag('789-B')).toBeUndefined()
    expect(store.removedBeams.size).toBe(0)
  })
})

describe('timber item store: discarding pending entries', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const entryId = (store: ReturnType<typeof useTimberItemStore>, type: string, itemId: string) =>
    store.events.find((event) => event.type === type && event.timber_item_id === itemId)!.id

  it('reverts an attribute value to what the remaining events and the snapshot give', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789-A')!
    const sortierklasse = attributeId('Sortierklasse')
    const before = store.findByTag('789-A')!.values[sortierklasse]![0]!.value
    store.recordAttribute(stem.id, sortierklasse, 'changed')
    expect(store.pendingCount).toBe(1)

    store.discardEntry(entryId(store, 'attribute_recorded', stem.id))
    expect(store.pendingCount).toBe(0)
    expect(store.findByTag('789-A')!.values[sortierklasse]![0]!.value).toBe(before)
    expect(cloneEverySave).not.toThrow()
  })

  it('removes a new stem with its beams and all their events, and frees the tag', () => {
    const store = useTimberItemStore()
    const synced = store.pendingCount
    const stem = store.createTimberItem(6)
    store.recordAttribute(stem.id, attributeId('Holzart'), 'x')
    const beam = store.addBeam(stem.id)
    store.recordAttribute(beam.id, attributeId('Sortierklasse'), 'x')
    store.addBeam(stem.id)

    store.discardEntry(entryId(store, 'created', stem.id))
    expect(store.events).toEqual([])
    expect(store.pendingCount).toBe(synced)
    expect(store.findByTag('6')).toBeUndefined()
    expect(store.findByTag('6-A')).toBeUndefined()
    expect(store.createTimberItem(6).tag_number).toBe('6')
    expect(cloneEverySave).not.toThrow()
  })

  it('frees the letter of a discarded new beam and leaves its stem and synced items alone', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(7)
    store.addBeam(stem.id)
    const second = store.addBeam(stem.id)
    store.discardEntry(entryId(store, 'created', second.id))
    expect(store.findByTag('7')!.has_children).toBe(true)
    expect(store.addBeam(stem.id).tag_number).toBe('7-B')

    const syncedBeam = store.findByTag('789-A')!
    expect(syncedBeam).toBeDefined()
    expect(store.findByTag('789')).toBeDefined()
  })

  it('refuses events that are no entry', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(8)
    expect(() => store.discardEntry(entryId(store, 'tag_assigned', stem.id))).toThrow()
    expect(() => store.discardEntry('unknown')).toThrow()
  })
})

describe('timber item store: event queue', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('queues created, tag_assigned and attribute_recorded in recording order', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(7)
    store.recordAttribute(stem.id, attributeId('Holzart'), 'oak')
    const beam = store.addBeam(stem.id)

    expect(store.events.map((event) => [event.type, event.timber_item_id, event.data])).toEqual([
      ['created', stem.id, { parent_id: null }],
      ['tag_assigned', stem.id, { tag_number: '7' }],
      ['attribute_recorded', stem.id, { attribute_id: attributeId('Holzart'), value: 'oak' }],
      ['created', beam.id, { parent_id: stem.id }],
      ['tag_assigned', beam.id, { tag_number: '7-A' }],
    ])
    expect(store.findByTag('7')!.values[attributeId('Holzart')]![0]!.event_id).toBe(
      store.events[2]!.id,
    )
    expect(store.pendingCount).toBe(3)
  })
})

describe('timber item store: projection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lays pending events over the snapshot without changing it, and restores both on load', async () => {
    const store = useTimberItemStore()
    const stored = JSON.stringify(store.snapshot)
    const existing = store.findByTag('789-A')!
    store.recordAttribute(existing.id, attributeId('Sortierklasse'), 'new')
    store.createTimberItem(8)
    expect(JSON.stringify(store.snapshot)).toBe(stored)

    // Wait until the queue is written, then start over as after an app restart.
    await new Promise((resolve) => setTimeout(resolve, 50))
    setActivePinia(createPinia())
    const reloaded = useTimberItemStore()
    await reloaded.load()
    expect(reloaded.findByTag('789-A')!.values[attributeId('Sortierklasse')]![0]!.value).toBe('new')
    expect(reloaded.findByTag('8')).toBeDefined()
    expect(reloaded.pendingCount).toBe(2)
  })
})

describe('timber item store: reload safety while writing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // A write the test finishes by hand, like a slow device.
  function holdNextWrite() {
    let finish!: (error?: Error) => void
    vi.mocked(save).mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = (error) => (error ? reject(error) : resolve())
        }),
    )
    return (error?: Error) => finish(error)
  }

  it('is unsafe while a write runs and safe after it ended', async () => {
    const store = useTimberItemStore()
    expect(store.isSafeToReload).toBe(true)
    const finish = holdNextWrite()
    store.createTimberItem(6)
    expect(store.isSafeToReload).toBe(false)
    finish()
    await vi.waitFor(() => expect(store.isSafeToReload).toBe(true))
  })

  it('is safe again after a failed write', async () => {
    const store = useTimberItemStore()
    const finish = holdNextWrite()
    store.createTimberItem(7)
    expect(store.isSafeToReload).toBe(false)
    finish(new Error('disk full'))
    await vi.waitFor(() => expect(store.isSafeToReload).toBe(true))
  })

  it('stays unsafe until every write has ended, also for a batch', async () => {
    const store = useTimberItemStore()
    const first = holdNextWrite()
    store.inOneTransaction(() => store.createTimberItem(8))
    const second = holdNextWrite()
    store.createTimberItem(9)
    first()
    await vi.waitFor(() => expect(store.pendingWrites).toBe(1))
    expect(store.isSafeToReload).toBe(false)
    second()
    await vi.waitFor(() => expect(store.isSafeToReload).toBe(true))
  })
})
