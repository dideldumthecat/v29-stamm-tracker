import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import { api, ApiError } from '@/api/client'
import { Blob as NodeBlob } from 'node:buffer'
import { load as loadStored, loadDiagnostics, save } from '@/persistence/database'

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
    // The fake API would take 600 ms for every photo other tests left in the shared fake IndexedDB.
    vi.spyOn(api, 'uploadPhoto')
      .mockRejectedValueOnce(new ApiError(400, 'Bad Request', '<html>'))
      .mockResolvedValue()
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
