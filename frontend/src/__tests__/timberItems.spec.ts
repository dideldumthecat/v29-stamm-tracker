import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import { api, ApiError } from '@/api/client'
import { save } from '@/persistence/database'

// Pass-through spy: tests can check what reaches IndexedDB.
vi.mock('@/persistence/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/persistence/database')>()
  return { ...original, save: vi.fn(original.save) }
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
    // The stem is read-only now, so change the stored value directly as an offline edit would.
    store.items.find((item) => item.id === stem.id)!.values[holzart]![0]!.value = 'second'
    expect(store.findByTag('5-A')!.values[holzart]![0]!.value).toBe('second')

    store.recordAttribute(beam.id, holzart, 'own')
    expect(store.findByTag('5-A')!.values[holzart]!.map((record) => record.value)).toEqual(['own'])
    expect(store.isInherited(beam.id, holzart)).toBe(false)
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

  it('letters beams, locks the parent and removes unsynced beams only', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    expect(store.addBeam(stem.id).tag_number).toBe('789-C')
    expect(() => store.recordAttribute(stem.id, attributeId('Holzart'), 'x')).toThrow()

    const synced = store.findByTag('789-A')!
    expect(store.canRemove(synced.id)).toBe(false)

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

describe('timber item store: tag changes', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('moves an item to a free tag; the old tag finds nothing and the change counts as an entry', () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    const before = store.pendingCount
    store.assignTag(beam.id, 345)
    expect(store.findByTag('345')!.id).toBe(beam.id)
    expect(store.findByTag('789-A')).toBeUndefined()
    expect(store.pendingCount).toBe(before + 1)
  })

  it('refuses a tag held in the snapshot or by pending events, and a split stem', () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    expect(store.tagHolder(456, beam.id)!.tag_number).toBe('456')
    expect(() => store.assignTag(beam.id, 456)).toThrow()

    const fresh = store.createTimberItem(9)
    expect(store.tagHolder(9, beam.id)!.id).toBe(fresh.id)
    expect(() => store.assignTag(beam.id, 9)).toThrow()
    expect(store.tagHolder(9, fresh.id)).toBeUndefined()

    expect(() => store.assignTag(store.findByTag('789')!.id, 790)).toThrow()
    expect(store.findByTag('789-A')!.id).toBe(beam.id)
  })

  it('does not hand out the letter of a renamed beam again', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    store.assignTag(store.findByTag('789-A')!.id, 345)
    expect(store.addBeam(stem.id).tag_number).toBe('789-C')
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

describe('timber item store: sync', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('removes only confirmed events and takes the new snapshot', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(9)
    store.recordAttribute(stem.id, attributeId('Holzart'), 'oak')
    const [created, tag, recorded] = store.events
    vi.spyOn(api, 'sync').mockResolvedValue({
      accepted_event_ids: [created!.id, tag!.id],
      rejected: [],
    })
    const fresh = api.initialSnapshot()
    fresh.generated_at = '2026-10-26T10:00:00.000Z'
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    expect(await store.sync()).toEqual({ transferred: 1, rejected: [] })
    expect(store.events).toEqual([recorded])
    expect(store.snapshot.generated_at).toBe('2026-10-26T10:00:00.000Z')
    expect(store.lastSyncedAt).not.toBeNull()
    expect(cloneEverySave).not.toThrow()
  })

  it('drops a rejected duplicate stem with its beam and later events, keeps the rest', async () => {
    const store = useTimberItemStore()
    const duplicate = store.createTimberItem(123)
    store.recordAttribute(duplicate.id, attributeId('Holzart'), 'oak')
    const beam = store.addBeam(duplicate.id)
    const other = store.createTimberItem(9)
    const sent = [...store.events]
    vi.spyOn(api, 'sync').mockImplementation(async () => {
      // Recorded while the sync runs: not in the batch, but on the rejected item.
      store.recordAttribute(beam.id, attributeId('Holzart'), 'oak')
      const rejected = sent.filter((event) => event.timber_item_id !== other.id)
      return {
        accepted_event_ids: sent.filter((event) => !rejected.includes(event)).map((e) => e.id),
        rejected: rejected.map((event) => ({
          event_id: event.id,
          timber_item_id: event.timber_item_id,
          tag_number: '123',
          reason: 'tag_already_taken' as const,
        })),
      }
    })
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    expect(await store.sync()).toEqual({
      transferred: 1,
      rejected: [{ tagNumber: '123', isBeam: false }],
    })
    expect(store.events).toEqual([])
    expect(store.findByTag('123-A')).toBeUndefined()
  })

  it('drops only a rejected tag change; the item keeps its tag and its other events go through', async () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    store.assignTag(beam.id, 345)
    store.recordAttribute(beam.id, attributeId('Holzart'), 'oak')
    const [tagChange, recorded] = store.events
    vi.spyOn(api, 'sync').mockResolvedValue({
      accepted_event_ids: [recorded!.id],
      rejected: [
        {
          event_id: tagChange!.id,
          timber_item_id: beam.id,
          tag_number: '345',
          reason: 'tag_already_taken',
        },
      ],
    })
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    expect(await store.sync()).toEqual({
      transferred: 1,
      rejected: [{ tagNumber: '345', isBeam: true, keptTag: '789-A' }],
    })
    expect(store.events).toEqual([])
    expect(store.findByTag('789-A')!.id).toBe(beam.id)
  })

  it('drops an item voided on the server and keeps the letter of a voided beam taken', async () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    const voided = store.findByTag('789-B')!
    // Recorded offline before the sync: the server accepts it, but it changes nothing.
    store.recordAttribute(voided.id, attributeId('Holzart'), 'oak')
    vi.spyOn(api, 'sync').mockResolvedValue({
      accepted_event_ids: store.events.map((event) => event.id),
      rejected: [],
    })
    const fresh = api.initialSnapshot()
    fresh.timber_items = fresh.timber_items.filter((item) => item.id !== voided.id)
    fresh.timber_items.find((item) => item.id === stem.id)!.voided_beam_tags = ['789-B']
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    await store.sync()
    expect(store.findByTag('789-B')).toBeUndefined()
    expect(store.events).toEqual([])
    expect(store.nextBeamTagOf(store.findByTag('789'), '789')).toBe('789-C')
  })

  it('keeps the whole queue when the snapshot download fails after the upload', async () => {
    const store = useTimberItemStore()
    store.createTimberItem(9)
    vi.spyOn(api, 'loadSnapshot').mockRejectedValue(new ApiError(0, 'offline'))

    await expect(store.sync()).rejects.toThrow(ApiError)
    expect(store.findByTag('9')).toBeDefined()
    expect(store.pendingCount).toBe(1)
    expect(store.lastSyncedAt).toBeNull()
  })
})

describe('timber item store: sign-in', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('loads the snapshot right after sign-in, keeping pending events', async () => {
    const store = useTimberItemStore()
    const fixture = api.initialSnapshot()
    store.snapshot = { ...fixture, attributes: [] }
    store.createTimberItem(9)
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fixture)

    await store.redeemInvite('token')
    expect(store.currentUser).not.toBeNull()
    expect(store.attributes.length).toBeGreaterThan(0)
    expect(store.pendingCount).toBe(1)
    expect(store.lastSyncedAt).toBeNull()
  })

  it('counts the sign-in as a sync when no events are pending', async () => {
    const store = useTimberItemStore()
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    await store.redeemInvite('token')
    expect(store.lastSyncedAt).not.toBeNull()
  })

  it('keeps the sign-in when the snapshot cannot be loaded', async () => {
    const store = useTimberItemStore()
    store.currentUser = null
    vi.spyOn(api, 'loadSnapshot').mockRejectedValue(new ApiError(0, 'offline'))

    await expect(store.redeemInvite('token')).resolves.toBeUndefined()
    expect(store.currentUser).not.toBeNull()
    expect(store.lastSyncedAt).toBeNull()
  })
})
