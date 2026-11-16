import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Blob as NodeBlob } from 'node:buffer'
import { useTimberItemStore } from '@/stores/timberItems'
import { api, ApiError } from '@/api/client'
import {
  addDiagnostic,
  load,
  loadDiagnostics,
  removeDiagnostics,
  save,
} from '@/persistence/database'
import { createEntry } from '@/diagnostics/record'
import { sendDiagnostics, setDiagnosticsSignedIn } from '@/diagnostics/send'

// A connection the browser ended: WebKit says this on every use until the page is reloaded.
const lost = () => new DOMException('Connection to Indexed Database server lost', 'UnknownError')
const failOnce = () =>
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
    throw lost()
  })
const failAlways = () =>
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
    throw lost()
  })
const jpeg = () => new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob
const photoAttribute = () =>
  useTimberItemStore().attributes.find((attribute) => attribute.type === 'photo')!.id

const entriesOf = async (kind: string) =>
  (await loadDiagnostics()).filter((entry) => entry.kind === kind)

describe('device storage: lost connection', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await save({ user: null, snapshot: null, events: [], lastSyncedAt: null }, { replaceAll: [] })
    await removeDiagnostics(await loadDiagnostics())
  })
  afterEach(() => vi.restoreAllMocks())

  it('reopens the connection and repeats a write once, without doubling anything', async () => {
    const open = vi.spyOn(indexedDB, 'open')
    const transaction = failOnce()
    await save({ lastSyncedAt: '2026-11-16T10:00:00.000Z' })

    expect(open).toHaveBeenCalledTimes(1)
    // Two tries on the state (the restored-connection report may add one on the diagnostics).
    expect(transaction.mock.calls.filter(([stores]) => Array.isArray(stores))).toHaveLength(2)
    expect((await load()).lastSyncedAt).toBe('2026-11-16T10:00:00.000Z')

    failOnce()
    await addDiagnostic(createEntry('warning', 'k', 'once'))
    expect((await loadDiagnostics()).filter((entry) => entry.kind === 'k')).toHaveLength(1)
  })

  it('records a restored connection as info', async () => {
    failOnce()
    await save({ lastSyncedAt: null })
    await vi.waitFor(async () =>
      expect(await entriesOf('device_storage')).toEqual([
        expect.objectContaining({
          level: 'info',
          message: 'Connection to device storage restored',
        }),
      ]),
    )
  })

  it('gives up after the second failure', async () => {
    const transaction = failAlways()
    await expect(save({ lastSyncedAt: null })).rejects.toThrow('Connection to Indexed Database')
    expect(transaction.mock.calls.filter(([stores]) => Array.isArray(stores))).toHaveLength(2)
  })

  it('keeps a diagnostics entry in memory while the storage is unreachable and sends it from there', async () => {
    failAlways()
    await addDiagnostic(createEntry('warning', 'kept', 'not stored'))
    expect(await entriesOf('kept')).toHaveLength(1)

    setDiagnosticsSignedIn(true)
    const send = vi.spyOn(api, 'sendDiagnostics').mockResolvedValue(undefined)
    await sendDiagnostics()

    expect(send.mock.calls[0]![0].entries.map((entry) => entry.kind)).toEqual(['kept'])
    expect(await entriesOf('kept')).toEqual([])
  })
})

describe('store: a write that finally fails', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await save({ user: null, snapshot: null, events: [], lastSyncedAt: null }, { replaceAll: [] })
    await removeDiagnostics(await loadDiagnostics())
  })
  afterEach(() => vi.restoreAllMocks())

  const settle = (store: ReturnType<typeof useTimberItemStore>) =>
    vi.waitFor(() => expect(store.pendingWrites).toBe(0))

  it('shows the notice and reports the failure to the server although IndexedDB is out', async () => {
    failAlways()
    const store = useTimberItemStore()
    store.createTimberItem(5)
    await settle(store)

    expect(store.hasUnsaved).toBe(true)
    expect(store.isSafeToReload).toBe(false)

    setDiagnosticsSignedIn(true)
    const send = vi.spyOn(api, 'sendDiagnostics').mockResolvedValue(undefined)
    await sendDiagnostics()
    const warning = send.mock.calls[0]![0].entries.find((entry) => entry.kind === 'device_storage')
    expect(warning).toMatchObject({
      level: 'warning',
      context: { error_name: 'UnknownError', pending_entries: 1 },
    })
    expect(String(warning!.context.error_message)).toContain('Connection to Indexed Database')
  })

  it('syncs the values from memory, and a photo that cannot be read does not fail the sync', async () => {
    failAlways()
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    await settle(store)
    const sync = vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())
    vi.spyOn(api, 'uploadPhoto').mockRejectedValue(new TypeError('Blob could not be read'))

    const result = await store.sync()

    expect(sync.mock.calls[0]![0].map((event) => event.type)).toEqual([
      'created',
      'tag_assigned',
      'attribute_recorded',
    ])
    expect(result).toMatchObject({ transferred: 1, photos: { uploaded: 0, failed: 1 } })
    // The photo is still only in memory.
    expect(store.hasUnsaved).toBe(true)
  })

  it('takes the notice back when everything is synced, and says why', async () => {
    failAlways()
    const store = useTimberItemStore()
    // The sync would send the reports away; they are to be read here.
    setDiagnosticsSignedIn(false)
    store.createTimberItem(5)
    await settle(store)
    expect(store.hasUnsaved).toBe(true)
    vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())

    await store.sync()

    expect(store.hasUnsaved).toBe(false)
    await vi.waitFor(async () =>
      expect(
        (await entriesOf('device_storage')).map((entry) => [entry.level, entry.context.reason]),
      ).toContainEqual(['info', 'synced']),
    )
  })

  it('writes the whole state once the storage is back, and takes the notice back', async () => {
    const failing = failAlways()
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    await settle(store)
    expect(store.hasUnsaved).toBe(true)
    // A write while the storage is still out does not clear anything.
    store.createTimberItem(6)
    await settle(store)
    expect(store.hasUnsaved).toBe(true)

    failing.mockRestore()
    store.createTimberItem(7)
    await vi.waitFor(() => expect(store.hasUnsaved).toBe(false))

    // Everything, not only the last change: three stems with their tags, and the photo.
    const stored = await load()
    expect(stored.events.map((event) => event.id)).toEqual(store.events.map((event) => event.id))
    expect(stored.events.filter((event) => event.type === 'created')).toHaveLength(3)
    expect(stored.photos).toHaveLength(1)
    expect(store.isSafeToReload).toBe(true)
    await vi.waitFor(async () =>
      expect((await entriesOf('device_storage')).map((entry) => entry.context.reason)).toContain(
        'saved',
      ),
    )
  })

  it('leaves one photo and no notice after a write that needed a second try', async () => {
    failOnce()
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    await settle(store)

    expect(store.hasUnsaved).toBe(false)
    const stored = await load()
    expect(stored.photos).toHaveLength(1)
    expect(stored.events).toHaveLength(3)
  })
})

describe('store: a photo whose upload fails', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await save({ user: null, snapshot: null, events: [], lastSyncedAt: null }, { replaceAll: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['an error that is not an ApiError', () => new TypeError('Blob could not be read')],
    [
      'a network break in the middle of the upload',
      () => new ApiError(0, 'TypeError: Load failed'),
    ],
  ])('stays pending and counted after %s, and goes up with the next sync', async (_name, fail) => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
      accepted_event_ids: events.map((event) => event.id),
      rejected: [],
    }))
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(api.initialSnapshot())
    const upload = vi.spyOn(api, 'uploadPhoto').mockRejectedValueOnce(fail())

    const first = await store.sync()

    expect(first.photos).toMatchObject({ uploaded: 0, failed: 1 })
    expect(store.photos).toHaveLength(1)
    expect(store.pendingCount).toBe(1)
    await vi.waitFor(async () => expect((await load()).photos).toHaveLength(1))

    upload.mockResolvedValue(undefined)
    const second = await store.sync()

    expect(upload).toHaveBeenCalledTimes(2)
    expect(second.photos).toMatchObject({ uploaded: 1, failed: 0 })
    expect(store.photos).toHaveLength(0)
    expect(store.pendingCount).toBe(0)
    await vi.waitFor(async () => expect((await load()).photos).toHaveLength(0))
  })
})

describe('store: discarding leaves a trace without values', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('counts what a discarded new stem takes with it', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(5)
    store.recordAttribute(stem.id, store.attributes.find((a) => a.name === 'Holzart')!.id, 'oak')
    store.addPhoto(stem.id, photoAttribute(), jpeg())
    store.addBeam(stem.id)
    store.addBeam(stem.id)

    store.discardEntry(store.events[0]!.id)

    await vi.waitFor(async () => expect(await entriesOf('discard')).toHaveLength(1))
    const [entry] = await entriesOf('discard')
    expect(entry).toMatchObject({
      level: 'info',
      context: { tag: '5', type: 'created', values: 1, photos: 1, beams: 2 },
    })
    expect(JSON.stringify(entry)).not.toContain('oak')
  })

  it('counts a single discarded value', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(6)
    store.recordAttribute(stem.id, store.attributes.find((a) => a.name === 'Holzart')!.id, 'oak')
    const value = store.events.find((event) => event.type === 'attribute_recorded')!

    store.discardEntry(value.id)

    await vi.waitFor(async () =>
      expect((await entriesOf('discard')).map((entry) => entry.context)).toContainEqual(
        expect.objectContaining({
          tag: '6',
          type: 'attribute_recorded',
          values: 1,
          photos: 0,
          beams: 0,
        }),
      ),
    )
  })
})
