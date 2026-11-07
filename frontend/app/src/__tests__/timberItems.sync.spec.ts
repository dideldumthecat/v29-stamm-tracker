import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import { api, ApiError } from '@/api/client'
import { addDiagnostic, loadDiagnostics, removeDiagnostics, save } from '@/persistence/database'
import { createEntry, record } from '@/diagnostics/record'
import { sendDiagnostics, startDiagnosticsSending } from '@/diagnostics/send'
import { restartWith, signedOut } from './storeSetup'

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
    await restartWith([tagEvent])
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

  it('drops an item voided on the server and frees the letter of a voided beam', async () => {
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
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    await store.sync()
    expect(store.findByTag('789-B')).toBeUndefined()
    expect(store.events).toEqual([])
    expect(store.nextBeamTagOf(store.findByTag('789'), '789')).toBe('789-B')
    expect(stem.tag_number).toBe('789')
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
    const fixture = api.initialSnapshot()
    vi.spyOn(api, 'initialSnapshot').mockReturnValueOnce({ ...fixture, attributes: [] })
    const store = useTimberItemStore()
    store.createTimberItem(9)
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fixture)

    await store.redeemInvite('token')
    expect(store.currentUser).not.toBeNull()
    expect(store.attributes.length).toBeGreaterThan(0)
    expect(store.pendingCount).toBe(1)
    expect(store.lastSyncedAt).not.toBeNull()
  })

  it('takes the own name from the user list of a downloaded snapshot and stores it', async () => {
    const fresh = api.initialSnapshot()
    vi.spyOn(api, 'initialUser').mockReturnValueOnce({ ...fresh.users[0]!, name: 'Old name' })
    const store = useTimberItemStore()
    fresh.users[0]!.name = 'New name'
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)

    await store.refresh()
    expect(store.currentUser?.name).toBe('New name')
    expect(vi.mocked(save)).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ name: 'New name' }) }),
    )
  })

  it('keeps the signed-in user when the snapshot does not list them', async () => {
    const own = { id: 'not-in-snapshot', name: 'Stranger' }
    vi.spyOn(api, 'initialUser').mockReturnValueOnce(own)
    const store = useTimberItemStore()
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    await store.refresh()
    expect(store.currentUser).toEqual(own)
    expect(vi.mocked(save).mock.lastCall![0]).not.toHaveProperty('user')
  })

  // The start after an app update: the entries of the old version wait in the buffer.
  it('sends the buffered diagnostics only once a sign-in is there', async () => {
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())
    signedOut()
    const store = useTimberItemStore()
    // A send of an earlier test may still be running; it must neither take this test's entry nor be counted.
    await sendDiagnostics()
    await removeDiagnostics(await loadDiagnostics())
    const send = vi.spyOn(api, 'sendDiagnostics').mockResolvedValue(undefined)
    await addDiagnostic(createEntry('info', 'update', 'Update found'))

    const stop = startDiagnosticsSending()
    stop()
    await vi.waitFor(async () => expect(await loadDiagnostics()).toHaveLength(1))
    expect(send).not.toHaveBeenCalled()

    await store.redeemInvite('token')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![0].entries.map((entry) => entry.message)).toEqual(['Update found'])
    await vi.waitFor(async () => expect(await loadDiagnostics()).toEqual([]))
  })

  it('sends the buffered diagnostics at the start when the stored sign-in is loaded', async () => {
    const user = api.initialUser()!
    signedOut()
    const store = useTimberItemStore()
    await sendDiagnostics()
    await removeDiagnostics(await loadDiagnostics())
    const send = vi.spyOn(api, 'sendDiagnostics').mockResolvedValue(undefined)
    await save({ user })
    await addDiagnostic(createEntry('info', 'update', 'Update found'))

    await store.load()
    const stop = startDiagnosticsSending()
    stop()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  })

  it('keeps the sign-in when the snapshot cannot be loaded', async () => {
    signedOut()
    const store = useTimberItemStore()
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
