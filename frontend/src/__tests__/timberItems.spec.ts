import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import { api, ApiError } from '@/api/client'
import { Blob as NodeBlob } from 'node:buffer'
import { load as loadStored, loadDiagnostics, save } from '@/persistence/database'
import { record } from '@/diagnostics/record'

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

  it('lists the beams of a stem by tag, whatever order they arrived in', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('789')!
    store.snapshot = { ...store.snapshot, timber_items: [...store.snapshot.timber_items].reverse() }
    expect(
      store.snapshot.timber_items.findIndex((item) => item.tag_number === '789-B'),
    ).toBeLessThan(store.snapshot.timber_items.findIndex((item) => item.tag_number === '789-A'))
    expect(store.childrenOf(stem.id).map((beam) => beam.tag_number)).toEqual(['789-A', '789-B'])
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

  it('reports the pending entries as the sync button counts them, next to the raw events', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(9)
    store.recordAttribute(stem.id, attributeId('Holzart'), 'oak')
    // created + tag_assigned + attribute_recorded: three events, but the tag belongs to the new stem.
    expect(store.events).toHaveLength(3)
    expect(store.pendingCount).toBe(2)
    vi.spyOn(api, 'sync').mockResolvedValue({
      accepted_event_ids: store.events.map((event) => event.id),
      rejected: [],
    })
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())
    vi.mocked(record).mockClear()

    await store.sync()

    expect(record).toHaveBeenCalledWith('info', 'sync', 'Sync started', {
      pending_entries: 2,
      pending_events: 3,
      pending_photos: 0,
    })
    expect(record).toHaveBeenCalledWith(
      'info',
      'sync',
      'Sync finished',
      expect.objectContaining({ transferred: 2 }),
    )
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

  it('ignores a rejected tag_assigned without a created: no message, the other events go through', async () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    const tagEvent = {
      id: crypto.randomUUID(),
      schema_version: 1 as const,
      type: 'tag_assigned' as const,
      timber_item_id: beam.id,
      recorded_at: new Date().toISOString(),
      data: { tag_number: '345' },
    }
    store.events.push(tagEvent)
    store.recordAttribute(beam.id, attributeId('Holzart'), 'oak')
    const [, recorded] = store.events
    vi.spyOn(api, 'sync').mockResolvedValue({
      accepted_event_ids: [recorded!.id],
      rejected: [
        {
          event_id: tagEvent.id,
          timber_item_id: beam.id,
          tag_number: '345',
          reason: 'tag_already_taken',
        },
      ],
    })
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    expect(await store.sync()).toEqual({ transferred: 1, rejected: [] })
    expect(store.events).toEqual([])
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
    expect(store.lastSyncedAt).not.toBeNull()
  })

  it('takes the own name from the user list of a downloaded snapshot and stores it', async () => {
    const store = useTimberItemStore()
    const fresh = api.initialSnapshot()
    store.currentUser = { ...fresh.users[0]!, name: 'Old name' }
    fresh.users[0]!.name = 'New name'
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    await store.refresh()
    expect(store.currentUser.name).toBe('New name')
    expect(vi.mocked(save)).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ name: 'New name' }) }),
    )
  })

  it('keeps the signed-in user when the snapshot does not list them', async () => {
    const store = useTimberItemStore()
    const own = { id: 'not-in-snapshot', name: 'Stranger' }
    store.currentUser = own
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    await store.refresh()
    expect(store.currentUser).toEqual(own)
    expect(vi.mocked(save).mock.lastCall![0]).not.toHaveProperty('user')
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

describe('timber item store: automatic refresh', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('downloads without uploading, keeps the queue and stamps the time', async () => {
    const store = useTimberItemStore()
    store.createTimberItem(9)
    const upload = vi.spyOn(api, 'sync')
    const fresh = api.initialSnapshot()
    fresh.generated_at = '2026-10-28T10:00:00.000Z'
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    await store.refresh()
    expect(upload).not.toHaveBeenCalled()
    expect(store.snapshot.generated_at).toBe('2026-10-28T10:00:00.000Z')
    expect(store.pendingCount).toBe(1)
    expect(store.findByTag('9')).toBeDefined()
    expect(store.lastSyncedAt).not.toBeNull()
  })

  it('leaves the time alone when the download fails', async () => {
    const store = useTimberItemStore()
    vi.spyOn(api, 'loadSnapshot').mockRejectedValue(new ApiError(0, 'offline'))

    await expect(store.refresh()).rejects.toThrow(ApiError)
    expect(store.lastSyncedAt).toBeNull()
  })

  it('runs one download for concurrent refreshes', async () => {
    const store = useTimberItemStore()
    const download = vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    await Promise.all([store.refresh(), store.refresh()])
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('runs one sync for concurrent syncs', async () => {
    const store = useTimberItemStore()
    store.createTimberItem(9)
    const upload = vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    const [first, second] = await Promise.all([store.sync(), store.sync()])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('still uploads when the sync button is tapped during a refresh', async () => {
    const store = useTimberItemStore()
    store.createTimberItem(9)
    const upload = vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    const download = vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    const refreshing = store.refresh()
    const result = await store.sync()
    await refreshing
    expect(upload).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(2)
    expect(result.transferred).toBe(1)
    expect(store.pendingCount).toBe(0)
  })

  it('skips a refresh while a sync runs', async () => {
    const store = useTimberItemStore()
    store.createTimberItem(9)
    vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    const download = vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    const syncing = store.sync()
    await store.refresh()
    await syncing
    expect(download).toHaveBeenCalledTimes(1)
  })
})

describe('timber item store: photos', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  // Node's Blob: the one the fake IndexedDB can store.
  const jpeg = (bytes = 10) =>
    new NodeBlob(['x'.repeat(bytes)], { type: 'image/jpeg' }) as unknown as Blob
  const photoAttribute = () =>
    useTimberItemStore().attributes.find((attribute) => attribute.type === 'photo')!.id
  const acceptAll = () =>
    vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
  const emptySnapshot = () => vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

  it('keeps the blob and queues the photo id for the photo attribute', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg(10))

    const [photo] = store.pendingPhotosOf(stem.id)
    expect(photo).toMatchObject({ timber_item_id: stem.id, size: 10 })
    expect(store.events.slice(-1)[0]).toMatchObject({
      type: 'attribute_recorded',
      data: { attribute_id: photoAttribute(), value: photo!.id },
    })
    expect(store.isPhotoQueued(photo!.id)).toBe(true)
    // Pending, not uploaded: the preview shows it, the count tile does not.
    expect(store.uploadedPhotoCount(stem.id, photoAttribute())).toBe(0)
  })

  it('counts a photo once, with the entries of the stem', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    expect(store.pendingCount).toBe(1)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    expect(store.pendingCount).toBe(3)
  })

  it('refuses a photo on a split stem', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addBeam(stem.id)
    expect(() => store.addPhoto(stem.id, photoAttribute(), jpeg())).toThrow()
  })

  it('removes a pending photo with its blob and event', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    store.removePhoto(store.pendingPhotosOf(stem.id)[0]!.id)
    expect(store.photos).toEqual([])
    expect(store.events.map((event) => event.type)).toEqual(['created', 'tag_assigned'])
  })

  it('takes the photos along when a pending entry or a whole new item is discarded', () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const photoEvent = store.events.slice(-1)[0]!
    store.discardEntry(photoEvent.id)
    expect(store.photos).toEqual([])

    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const other = store.createTimberItem(6)
    store.addPhoto(other.id, photoAttribute(), jpeg())
    store.discardEntry(
      store.events.find((event) => event.type === 'created' && event.timber_item_id === stem.id)!
        .id,
    )
    expect(store.photos.map((photo) => photo.timber_item_id)).toEqual([other.id])
  })

  it('writes a stem, its values and its photos in one transaction', () => {
    const store = useTimberItemStore()
    vi.mocked(save).mockClear()
    store.inOneTransaction(() => {
      const stem = store.createTimberItem(6)
      store.addPhoto(stem.id, photoAttribute(), jpeg())
      store.addPhoto(stem.id, photoAttribute(), jpeg())
    })
    expect(save).toHaveBeenCalledTimes(1)
    const [parts, changes] = vi.mocked(save).mock.calls[0]!
    expect(parts.events).toHaveLength(4)
    expect(changes?.add).toHaveLength(2)
    expect(store.photos).toHaveLength(2)
  })

  it('restores photos after a restart', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg(7))
    const id = store.photos[0]!.id
    // The device storage is shared by the tests of this file, so look for this photo only.
    await vi.waitFor(async () =>
      expect((await loadStored()).photos.map((photo) => photo.id)).toContain(id),
    )

    setActivePinia(createPinia())
    const reloaded = useTimberItemStore()
    await reloaded.load()
    expect(reloaded.photos.find((photo) => photo.id === id)?.size).toBe(7)
  })

  it('uploads the data first, then the photos one by one, and deletes each blob after its upload', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const order: string[] = []
    acceptAll().mockImplementationOnce(async (events) => {
      order.push('data')
      return { accepted_event_ids: events.map((event) => event.id), rejected: [] }
    })
    emptySnapshot()
    const steps: unknown[] = []
    const upload = vi.spyOn(api, 'uploadPhoto').mockImplementation(async (photo) => {
      order.push(photo.id)
      steps.push({ ...store.progress, left: store.photos.length })
    })
    const ids = store.photos.map((photo) => photo.id)

    const result = await store.sync()
    expect(order).toEqual(['data', ...ids])
    expect(upload.mock.calls[0]![0]).toMatchObject({ id: ids[0], timber_item_id: stem.id })
    expect(steps).toEqual([
      { phase: 'photos', done: 0, total: 2, left: 2 },
      { phase: 'photos', done: 1, total: 2, left: 1 },
    ])
    // Photos are reported on their own, not as entries.
    expect(result).toEqual({
      transferred: 1,
      rejected: [],
      photos: { uploaded: 2, failed: 0, errorStatus: null },
    })
    expect(store.photos).toEqual([])
    expect(store.progress).toBeNull()
    expect(store.pendingCount).toBe(0)
  })

  it('reports each upload with its size, attempt and where the blob came from', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg(7))
    const id = store.photos[0]!.id
    await vi.waitFor(async () =>
      expect((await loadStored()).photos.map((photo) => photo.id)).toContain(id),
    )
    acceptAll()
    emptySnapshot()
    vi.spyOn(api, 'uploadPhoto').mockRejectedValueOnce(new ApiError(400, 'Bad Request', '<html>'))
    const entryFor = async (message: string) =>
      vi.waitFor(async () => {
        const entry = (await loadDiagnostics()).find((candidate) => candidate.message === message)
        expect(entry).toBeDefined()
        return entry!
      })

    // Just captured: the blob in memory is the camera's.
    await store.sync()
    const failed = await entryFor(`Photo ${id.slice(0, 8)} upload failed (400)`)
    expect(failed).toMatchObject({ level: 'error', kind: 'photo_upload' })
    expect(failed.context).toMatchObject({
      bytes: 7,
      attempt: 1,
      blob_source: 'fresh',
      status: 400,
      body_start: '<html>',
    })

    // After a restart it is read back from the device storage.
    setActivePinia(createPinia())
    const reloaded = useTimberItemStore()
    await reloaded.load()
    await reloaded.sync()
    const uploaded = await entryFor(`Photo ${id.slice(0, 8)} uploaded`)
    expect(uploaded.context).toMatchObject({ bytes: 7, attempt: 1, blob_source: 'stored' })
  })

  it('leaves the blob of a failed upload pending and still tries the next photo', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const [first, second] = store.photos.map((photo) => photo.id)
    acceptAll()
    emptySnapshot()
    const upload = vi.spyOn(api, 'uploadPhoto').mockImplementation(async (photo) => {
      if (photo.id === first) {
        throw new ApiError(0, 'offline')
      }
    })

    const result = await store.sync()
    expect(upload).toHaveBeenCalledTimes(2)
    expect(result.photos).toEqual({ uploaded: 1, failed: 1, errorStatus: 0 })
    expect(store.photos.map((photo) => photo.id)).toEqual([first])
    expect(second).not.toBe(first)
    // The photo event went through; only the file is left, counted once.
    expect(store.events).toEqual([])
    expect(store.pendingCount).toBe(1)
  })

  it('keeps events and photos when the data phase is cancelled, and finishes later without duplicates', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const controller = new AbortController()
    vi.spyOn(api, 'sync').mockImplementation(async () => {
      controller.abort()
      throw new ApiError(0, 'aborted')
    })
    const upload = vi.spyOn(api, 'uploadPhoto').mockResolvedValue()

    expect(await store.sync(controller.signal)).toEqual({
      transferred: 0,
      rejected: [],
      cancelled: 'data',
    })
    expect(upload).not.toHaveBeenCalled()
    expect(store.events).toHaveLength(3)
    expect(store.pendingCount).toBe(2)

    vi.restoreAllMocks()
    vi.spyOn(api, 'uploadPhoto').mockResolvedValue()
    acceptAll()
    emptySnapshot()
    const result = await store.sync()
    expect(result).toMatchObject({ transferred: 1, photos: { uploaded: 1 } })
    expect(store.pendingCount).toBe(0)
  })

  it('keeps uploaded photos done and the rest pending when the photos are cancelled', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    for (let count = 0; count < 3; count++) {
      store.addPhoto(stem.id, photoAttribute(), jpeg())
    }
    const remaining = store.photos.slice(1).map((photo) => photo.id)
    acceptAll()
    emptySnapshot()
    const controller = new AbortController()
    vi.spyOn(api, 'uploadPhoto').mockImplementation(async () => {
      controller.abort()
    })

    const result = await store.sync(controller.signal)
    expect(result.cancelled).toBe('photos')
    expect(result.photos).toEqual({ uploaded: 1, failed: 0, errorStatus: null })
    expect(store.photos.map((photo) => photo.id)).toEqual(remaining)
  })

  it('treats an upload aborted in flight as cancelled, not failed', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    acceptAll()
    emptySnapshot()
    const controller = new AbortController()
    vi.spyOn(api, 'uploadPhoto').mockImplementation(async () => {
      controller.abort()
      throw new ApiError(0, 'aborted')
    })

    const result = await store.sync(controller.signal)
    expect(result).toMatchObject({ cancelled: 'photos', photos: { uploaded: 0, failed: 0 } })
    expect(store.photos).toHaveLength(1)
  })

  it('drops the photos of a rejected duplicate stem', async () => {
    const store = useTimberItemStore()
    const duplicate = store.createTimberItem(123)
    store.addPhoto(duplicate.id, photoAttribute(), jpeg())
    const beam = store.findByTag('789-A')!
    store.addPhoto(beam.id, photoAttribute(), jpeg())
    const duplicateEvents = store.events.filter((event) => event.timber_item_id === duplicate.id)
    vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events
        .filter((event) => !duplicateEvents.includes(event))
        .map((event) => event.id),
      rejected: duplicateEvents.map((event) => ({
        event_id: event.id,
        timber_item_id: event.timber_item_id,
        tag_number: '123',
        reason: 'tag_already_taken' as const,
      })),
    }))
    emptySnapshot()
    const upload = vi.spyOn(api, 'uploadPhoto').mockResolvedValue()

    await store.sync()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0]![0].timber_item_id).toBe(beam.id)
    expect(store.photos).toEqual([])
    expect(store.pendingCount).toBe(0)
  })

  it('counts the photos the server knows, minus the ones still on the device', () => {
    const store = useTimberItemStore()
    const stem = store.findByTag('123')!
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const recorded = store.findByTag('123')!.values[photoAttribute()] ?? []
    const [pending] = store.pendingPhotosOf(stem.id)
    expect(recorded.map((record) => record.value)).toContain(pending!.id)
    expect(store.uploadedPhotoCount(stem.id, photoAttribute())).toBe(recorded.length - 1)
  })

  it('cannot remove a photo whose event the server already has', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    const [photo] = store.photos
    acceptAll()
    emptySnapshot()
    vi.spyOn(api, 'uploadPhoto').mockRejectedValue(new ApiError(0, 'offline'))
    await store.sync()
    expect(store.isPhotoQueued(photo!.id)).toBe(false)
    expect(() => store.removePhoto(photo!.id)).toThrow()
  })
})
