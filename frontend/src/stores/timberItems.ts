/**
 * Displayed state = stored snapshot (as the server sent it) + own pending events laid over it.
 * Every change is an event in the queue, saved on the device right away; the snapshot is only
 * replaced by a sync, an automatic refresh or right after sign-in. The views rely on the public surface, so keep it stable or adjust them with it.
 *
 * `items` holds own values only; inherited values are added at read time (withInherited).
 */
import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import type {
  AttributeValueRecord,
  AttributeValue,
  Event,
  TimberItem,
  Timestamp,
  Uuid,
} from '@/api/contract'
import { api, ApiError, describeFailure, type User } from '@/api/client'
import {
  load as loadStored,
  save,
  type PhotoChanges,
  type StoredPhoto,
  type StoredState,
} from '@/persistence/database'
import { useToast } from '@/composables/useToast'
import { record } from '@/diagnostics/record'
import { sendDiagnostics } from '@/diagnostics/send'
import { SYNC_TIMEOUT_MS } from '@/config/constants'
import { nextBeamTag } from '@/utils/tag'

// The app uses the contract types directly (snake_case, as on the wire) – no second model, no mapper.
export type { Attribute, AttributeOption, AttributeValueRecord, TimberItem } from '@/api/contract'
export type { User } from '@/api/client'
export type { StoredPhoto } from '@/persistence/database'

// A type, not an interface: it travels as router history state, which needs an index signature.
export type SyncResult = {
  transferred: number
  /** Tags another item already holds: a duplicate capture, what this device recorded on it is gone. */
  rejected: { tagNumber: string; isBeam: boolean }[]
  /** Only set if photos were waiting. Failed ones stay on the device; errorStatus is the first failure's (ApiError). */
  photos?: { uploaded: number; failed: number; errorStatus: number | null }
  /** The user cancelled: during the data phase nothing changed, during the photos the rest stays pending. */
  cancelled?: 'data' | 'photos'
}

export type SyncProgress = { phase: 'data' } | { phase: 'photos'; done: number; total: number }

export const useTimberItemStore = defineStore('timberItems', () => {
  const snapshot = ref(api.initialSnapshot())
  // Set by signing in with the invite code; null until then.
  const currentUser = ref<User | null>(api.initialUser())
  const users = computed(() => snapshot.value.users)
  const attributes = computed(() => snapshot.value.attributes)
  // Own events waiting for the sync, in the order they were recorded.
  const events = ref<Event[]>([])
  const lastSyncedAt = ref<Timestamp | null>(null)
  // What the user did, not the wire format: the tag always belongs to the "created" of its item.
  const isEntry = (event: Event) => event.type !== 'tag_assigned'
  // Photos not uploaded yet; the blobs live in their own object store, the event with the photo id in the queue.
  const photos = ref<StoredPhoto[]>([])
  // Captured since this start: the blob is still the one from the camera, not read back from IndexedDB (diagnostics only).
  const freshPhotoIds = new Set<Uuid>()
  const photoAttempts = new Map<Uuid, number>()
  const pendingPhotoIds = computed(() => new Set(photos.value.map((photo) => photo.id)))
  const isPhotoEvent = (event: Event) =>
    event.type === 'attribute_recorded' && pendingPhotoIds.value.has(String(event.data.value))
  // A photo counts once, not for its event and again for its file.
  const pendingCount = computed(
    () =>
      events.value.filter((event) => isEntry(event) && !isPhotoEvent(event)).length +
      photos.value.length,
  )
  const progress = ref<SyncProgress | null>(null)
  // The running sync lives here, not in a screen: a screen opened later sees it and can stop it.
  const isSyncing = ref(false)
  // Between `stopSync()` and the actual end of the sync.
  const isStopping = ref(false)
  let syncController: AbortController | undefined

  // Writes collected by `inOneTransaction`; null = write each change on its own.
  let collected: { parts: Partial<StoredState>; add: StoredPhoto[] } | null = null

  // A failed write only warns; the change stays in memory until the app is closed.
  function persist(parts: Partial<StoredState>, photoChanges?: PhotoChanges) {
    if (collected) {
      // Only additions are batched: removals never happen inside a batch.
      Object.assign(collected.parts, parts)
      collected.add.push(...(photoChanges?.add ?? []))
      return
    }
    // Without photo changes the call stays as it was: only the parts.
    const hasPhotoChanges =
      photoChanges && (photoChanges.add?.length || photoChanges.remove?.length)
    ;(hasPhotoChanges ? save(parts, photoChanges) : save(parts)).catch(() =>
      useToast().show({ before: 'Speichern auf dem Gerät fehlgeschlagen', kind: 'warning' }),
    )
  }

  /**
   * Runs `changes` and writes everything it recorded in one transaction: a crash leaves all of it or none.
   * The in-memory state changes at once; only the write waits.
   */
  function inOneTransaction<T>(changes: () => T): T {
    const outer = collected
    const batch = (collected ??= { parts: {}, add: [] })
    try {
      return changes()
    } finally {
      collected = outer
      if (!outer) {
        persist(batch.parts, { add: batch.add })
      }
    }
  }

  function emit<T extends Event['type']>(
    type: T,
    timberItemId: Uuid,
    data: Extract<Event, { type: T }>['data'],
    photo?: StoredPhoto,
  ): Event {
    const event = {
      id: crypto.randomUUID(),
      schema_version: 1,
      type,
      timber_item_id: timberItemId,
      recorded_at: new Date().toISOString(),
      data,
    } as Event
    events.value.push(event)
    // The photo goes in the same transaction: a blob without its event would be an orphan after a crash.
    persist({ events: toRaw(events.value) }, photo && { add: [photo] })
    return event
  }

  // Filter the raw array: filtering the reactive one yields proxies, which IndexedDB cannot store.
  function dropEvents(isDropped: (event: Event) => boolean): Event[] {
    events.value = toRaw(events.value).filter((event) => !isDropped(event))
    return toRaw(events.value)
  }

  function dropPhotos(isDropped: (photo: StoredPhoto) => boolean): Uuid[] {
    const dropped = toRaw(photos.value)
      .filter(isDropped)
      .map((photo) => photo.id)
    photos.value = toRaw(photos.value).filter((photo) => !dropped.includes(photo.id))
    return dropped
  }

  /**
   * The user throws entries away: their photos go too (a blob without an item would be uploaded as an orphan).
   * itemIds: items removed as a whole, with every photo they hold.
   */
  function discard(isDropped: (event: Event) => boolean, itemIds = new Set<Uuid>()) {
    const photoIds = new Set(
      events.value.flatMap((event) =>
        isDropped(event) && event.type === 'attribute_recorded' ? [String(event.data.value)] : [],
      ),
    )
    persist(
      { events: dropEvents(isDropped) },
      {
        remove: dropPhotos((photo) => photoIds.has(photo.id) || itemIds.has(photo.timber_item_id)),
      },
    )
  }

  const hasPendingCreated = (itemId: string) =>
    events.value.some((event) => event.type === 'created' && event.timber_item_id === itemId)

  const lastEventId = (records: AttributeValueRecord[] | undefined) =>
    records?.slice(-1)[0]?.event_id

  // Rebuilt whenever the snapshot or the queue changes; copies, so the snapshot itself stays untouched.
  const items = computed<TimberItem[]>(() => {
    const byId = new Map(
      snapshot.value.timber_items.map((item) => [item.id, { ...item, values: { ...item.values } }]),
    )
    // The snapshot delivers beams with their inherited values (as timber_item_state does).
    // Strip those, so a parent changed offline is followed by its beams.
    for (const item of byId.values()) {
      const parent = item.parent_id ? byId.get(item.parent_id) : undefined
      for (const attributeId of Object.keys(item.values)) {
        const own = lastEventId(item.values[attributeId])
        if (parent && own !== undefined && own === lastEventId(parent.values[attributeId])) {
          delete item.values[attributeId]
        }
      }
    }

    const stemsWithRemovedBeam = new Set<Uuid>()
    for (const event of events.value) {
      if (event.type === 'voided') {
        // Gone at once, like on the server after the sync; its letter is free again.
        const beam = byId.get(event.timber_item_id)
        byId.delete(event.timber_item_id)
        if (beam?.parent_id) {
          stemsWithRemovedBeam.add(beam.parent_id)
        }
        continue
      }
      if (event.type === 'created') {
        const parentId = event.data.parent_id
        byId.set(event.timber_item_id, {
          id: event.timber_item_id,
          parent_id: parentId,
          tag_number: null,
          has_children: false,
          created_at: event.recorded_at,
          created_by: currentUser.value?.id ?? '',
          values: {},
        })
        const parent = parentId ? byId.get(parentId) : undefined
        if (parent) {
          parent.has_children = true
        }
        continue
      }
      // Unknown item: voided on the server meanwhile – nothing to show it on.
      const item = byId.get(event.timber_item_id)
      if (!item) {
        continue
      }
      if (event.type === 'tag_assigned') {
        item.tag_number = event.data.tag_number
        continue
      }
      const { attribute_id: attributeId, value } = event.data
      const record = {
        value,
        recorded_at: event.recorded_at,
        user_id: currentUser.value?.id ?? '',
        event_id: event.id,
      }
      // Series keep every recording; all other attributes hold exactly one (the current value).
      const isSeries = attributes.value.find((attribute) => attribute.id === attributeId)?.is_series
      item.values[attributeId] = isSeries ? [...(item.values[attributeId] ?? []), record] : [record]
    }
    // A stem whose last beam is removed is editable again, also offline (the server does the same).
    for (const stemId of stemsWithRemovedBeam) {
      const stem = byId.get(stemId)
      if (stem) {
        stem.has_children = [...byId.values()].some((item) => item.parent_id === stemId)
      }
    }
    return [...byId.values()]
  })

  // Synced beams the user removed and the sync has not sent yet: gone from `items`, but the sync screen still names them.
  const removedBeams = computed(
    () =>
      new Map(
        events.value
          .filter((event) => event.type === 'voided')
          .flatMap((event) => {
            const beam = snapshot.value.timber_items.find(
              (item) => item.id === event.timber_item_id,
            )
            return beam ? [[beam.id, beam] as const] : []
          }),
      ),
  )

  const findById = (id: string | null) => items.value.find((item) => item.id === id)

  /** Called once before the app mounts: the router guards already need the stored state. */
  async function load() {
    const stored = await loadStored()
    currentUser.value = stored.user ?? currentUser.value
    snapshot.value = stored.snapshot ?? snapshot.value
    events.value = stored.events
    photos.value = stored.photos
    lastSyncedAt.value = stored.lastSyncedAt
  }

  // At most one transfer at a time: a snapshot that arrives late must not overwrite a newer one.
  let refreshing: Promise<void> | null = null
  let syncing: Promise<SyncResult> | null = null

  /**
   * Own events up, then the snapshot down. Throws ApiError on failure; the queue keeps whatever the
   * server has not confirmed. Returns how many entries (as counted by pendingCount) were transferred,
   * and the tags the server rejected: duplicate captures are dropped from the device, rejected tag changes only.
   * A second call while one runs gets the running one; a running refresh finishes first, so the upload is never skipped.
   */
  function sync(signal?: AbortSignal): Promise<SyncResult> {
    if (!syncing) {
      const controller = new AbortController()
      syncController = controller
      isSyncing.value = true
      const stoppable = AbortSignal.any(signal ? [controller.signal, signal] : [controller.signal])
      syncing = (async () => {
        await refreshing?.catch(() => {})
        try {
          void record('info', 'sync', 'Sync started', {
            pending_entries: pendingCount.value,
            pending_events: events.value.length,
            pending_photos: photos.value.length,
          })
          const result = await syncDataAndPhotos(stoppable)
          void record('info', 'sync', result.cancelled ? 'Sync stopped' : 'Sync finished', {
            transferred: result.transferred,
            rejected: result.rejected.length,
            photos_uploaded: result.photos?.uploaded,
            photos_failed: result.photos?.failed,
            stopped_in: result.cancelled,
          })
          return result
        } catch (error) {
          void record('warning', 'sync', 'Sync failed', {
            status: error instanceof ApiError ? error.status : undefined,
          })
          throw error
        } finally {
          progress.value = null
        }
      })().finally(() => {
        syncing = null
        syncController = undefined
        isSyncing.value = false
        isStopping.value = false
        // Successful or not: the reports of this sync go out too.
        void sendDiagnostics()
      })
    }
    return syncing
  }

  /** Stops the running sync, whichever screen started it; what has not been confirmed stays on the device. */
  function stopSync() {
    if (syncController) {
      isStopping.value = true
      syncController.abort()
    }
  }

  // Data first, then the photos one by one; `signal` cancels either phase.
  async function syncDataAndPhotos(signal?: AbortSignal): Promise<SyncResult> {
    progress.value = { phase: 'data' }
    // One timeout for upload and download together; the queue is untouched until both are through.
    const dataSignal = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(SYNC_TIMEOUT_MS),
    ])
    let result: SyncResult
    try {
      result = await uploadAndDownload(dataSignal)
    } catch (error) {
      // Cancelled: the events stay queued, the server ignores them if they arrived after all.
      if (signal?.aborted) {
        return { transferred: 0, rejected: [], cancelled: 'data' }
      }
      throw error
    }
    return { ...result, ...(await uploadPhotos(signal)) }
  }

  /**
   * Uploads what the device still holds, one photo per request. A blob goes only after the server confirmed it;
   * a failure keeps that photo and the next one is still tried.
   */
  async function uploadPhotos(
    signal?: AbortSignal,
  ): Promise<Pick<SyncResult, 'photos' | 'cancelled'>> {
    const queue = [...toRaw(photos.value)]
    if (queue.length === 0) {
      return {}
    }
    const stats = { uploaded: 0, failed: 0, errorStatus: null as number | null }
    let cancelled = false
    for (const photo of queue) {
      progress.value = { phase: 'photos', done: stats.uploaded + stats.failed, total: queue.length }
      if (signal?.aborted) {
        cancelled = true
        break
      }
      const started = performance.now()
      try {
        await api.uploadPhoto(
          {
            id: photo.id,
            timber_item_id: photo.timber_item_id,
            taken_at: photo.taken_at,
            blob: photo.blob,
          },
          signal,
        )
        reportPhotoUpload(photo, started)
        persist({}, { remove: dropPhotos((candidate) => candidate.id === photo.id) })
        stats.uploaded++
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error
        }
        reportPhotoUpload(photo, started, error, signal)
        if (signal?.aborted) {
          cancelled = true
          break
        }
        stats.failed++
        stats.errorStatus ??= error.status
      }
    }
    return { photos: stats, ...(cancelled && { cancelled: 'photos' as const }) }
  }

  // One entry per photo and attempt outcome. "stored" next to "fresh" tells whether a blob that went through
  // IndexedDB behaves differently on upload (suspected for Safari).
  function reportPhotoUpload(
    photo: StoredPhoto,
    started: number,
    error?: ApiError,
    signal?: AbortSignal,
  ) {
    const attempt = (photoAttempts.get(photo.id) ?? 0) + 1
    photoAttempts.set(photo.id, attempt)
    const context = {
      bytes: photo.size,
      attempt,
      blob_source: freshPhotoIds.has(photo.id) ? 'fresh' : 'stored',
      duration_ms: Math.round(performance.now() - started),
    }
    const name = `Photo ${photo.id.slice(0, 8)}`
    if (!error) {
      void record('info', 'photo_upload', `${name} uploaded`, context)
      return
    }
    const { outcome, level, context: failure } = describeFailure(error, signal)
    void record(level, 'photo_upload', `${name} upload failed (${outcome})`, {
      ...context,
      ...failure,
    })
  }

  /**
   * Snapshot down only, nothing leaves the device: the automatic update. Does nothing while a sync runs,
   * which downloads anyway. Throws ApiError on failure.
   */
  function refresh(): Promise<void> {
    if (syncing) {
      return Promise.resolve()
    }
    refreshing ??= downloadSnapshot().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  async function uploadAndDownload(signal: AbortSignal): Promise<SyncResult> {
    // Events recorded while the sync runs are not part of this batch and stay in the queue.
    const batch = [...toRaw(events.value)]
    // Photos report themselves; the event that carries their id is not an entry of its own.
    const photoEventIds = new Set(batch.filter(isPhotoEvent).map((event) => event.id))
    const response = batch.length > 0 ? await api.sync(batch, signal) : null
    const accepted = new Set(response?.accepted_event_ids)
    const rejectedEvents = new Set(response?.rejected.map((entry) => entry.event_id))
    // An item is gone only if its creation was rejected.
    const rejectedItems = new Set(
      batch
        .filter((event) => event.type === 'created' && rejectedEvents.has(event.id))
        .map((event) => event.timber_item_id),
    )
    const duplicateTags = (response?.rejected ?? [])
      .filter((entry) => rejectedItems.has(entry.timber_item_id))
      .map((entry) => entry.tag_number)
    // Read before the queue changes: afterwards the rejected items are gone.
    const rejected: SyncResult['rejected'] = [...new Set(duplicateTags)].map((tagNumber) => ({
      tagNumber,
      isBeam: items.value.some(
        (item) => rejectedItems.has(item.id) && item.tag_number === tagNumber && item.parent_id,
      ),
    }))
    // Later events on a rejected item would only be rejected with it next time.
    await downloadSnapshot({
      isDone: (event) =>
        accepted.has(event.id) ||
        rejectedEvents.has(event.id) ||
        rejectedItems.has(event.timber_item_id),
      // The item is gone, so are its photos.
      isPhotoDropped: (photo) => rejectedItems.has(photo.timber_item_id),
      signal,
    })
    return {
      transferred: batch.filter(
        (event) => isEntry(event) && accepted.has(event.id) && !photoEventIds.has(event.id),
      ).length,
      rejected,
    }
  }

  async function downloadSnapshot({
    isDone = () => false,
    isPhotoDropped = () => false,
    signal,
  }: {
    isDone?: (event: Event) => boolean
    isPhotoDropped?: (photo: StoredPhoto) => boolean
    signal?: AbortSignal
  } = {}) {
    const fresh = await api.loadSnapshot(signal)
    // Accepted events leave the queue only together with the snapshot that contains them, so a failed
    // download hides nothing. Resending them next time is harmless: the server ignores known ids.
    snapshot.value = fresh
    // The time stands for how current the data is, whether or not entries are still waiting for the upload.
    lastSyncedAt.value = new Date().toISOString()
    // The name is set at sign-in only; a rename in the database reaches the app through the user list.
    const renamed = fresh.users.find(
      (user) => user.id === currentUser.value?.id && user.name !== currentUser.value.name,
    )
    if (renamed) currentUser.value = { ...currentUser.value!, name: renamed.name }
    persist(
      {
        snapshot: fresh,
        events: dropEvents(isDone),
        lastSyncedAt: lastSyncedAt.value,
        ...(renamed && { user: toRaw(currentUser.value) }),
      },
      { remove: dropPhotos(isPhotoDropped) },
    )
  }

  // Same rules as the server projection: inheritable attributes come from the parent unless the
  // beam has its own value; a series is taken as a whole list, never merged.
  function withInherited(item: TimberItem): TimberItem {
    const parent = findById(item.parent_id)
    if (!parent) {
      return item
    }
    const inherited = attributes.value
      .filter((attribute) => attribute.is_inheritable && parent.values[attribute.id])
      .map((attribute) => [attribute.id, parent.values[attribute.id]!])
    return { ...item, values: { ...Object.fromEntries(inherited), ...item.values } }
  }

  // tag_number is a string in the contract ("123", beams "123-A"); the start screen only knows numbers.
  function findByTagNumber(tagNumber: number): TimberItem | undefined {
    return findByTag(String(tagNumber))
  }

  function findByTag(tag: string): TimberItem | undefined {
    const item = items.value.find((candidate) => candidate.tag_number === tag)
    return item && withInherited(item)
  }

  // Sorted by tag like the Excel export: the snapshot order is device time, which skews between phones.
  // Beams without a tag come last.
  function childrenOf(itemId: string): TimberItem[] {
    return items.value
      .filter((item) => item.parent_id === itemId)
      .map(withInherited)
      .sort(
        (a, b) =>
          Number(a.tag_number === null) - Number(b.tag_number === null) ||
          (a.tag_number ?? '').localeCompare(b.tag_number ?? ''),
      )
  }

  // undefined parent = stem not created yet, so no beams either. A removed beam frees its letter.
  // draftTags: beams of a draft that is not saved yet; they count, so a letter once shown is never handed out twice.
  function nextBeamTagOf(
    parent: TimberItem | undefined,
    parentTag: string,
    draftTags: string[] = [],
  ): string | null {
    const beamTags = parent ? childrenOf(parent.id).map((beam) => beam.tag_number) : []
    return nextBeamTag(parentTag, [...beamTags, ...draftTags])
  }

  // Inherited = the beam shows the very recording its parent holds.
  function isInherited(itemId: string, attributeId: string): boolean {
    const item = findById(itemId)
    const parent = item && findById(item.parent_id)
    if (!item || !parent) {
      return false
    }
    const own = lastEventId(withInherited(item).values[attributeId])
    return own !== undefined && own === lastEventId(parent.values[attributeId])
  }

  // Own name before the first sync: the snapshot does not know this user yet.
  function userName(userId: string): string {
    const user = [...users.value, currentUser.value].find((candidate) => candidate?.id === userId)
    return user?.name ?? 'Unbekannt'
  }

  async function redeemInvite(token: string) {
    currentUser.value = (await api.redeemInvite(token)).user
    persist({ user: toRaw(currentUser.value) })
    // Reports kept after a 401 can go now.
    void sendDiagnostics({ afterSignIn: true })
    // Attributes come only with the snapshot; without them nothing can be recorded offline.
    // Failing here is fine: the sign-in stands and the next sync fetches it.
    await refresh().catch(() => {})
  }

  function createTimberItem(tagNumber: number): TimberItem {
    return create(String(tagNumber), null)
  }

  // The parent is split from then on and accepts no more recordings.
  // tag: the letter the draft showed already; without it the next free one.
  function addBeam(parentId: string, tag?: string | null): TimberItem {
    const parent = findById(parentId)
    if (!parent?.tag_number || parent.parent_id) {
      throw new Error(`Cannot add a beam to timber item ${parentId}`)
    }
    tag ??= nextBeamTagOf(parent, parent.tag_number)
    if (!tag) {
      throw new Error(`Timber item ${parentId} has no beam letters left`)
    }
    return create(tag, parentId)
  }

  function create(tagNumber: string, parentId: string | null): TimberItem {
    const id = crypto.randomUUID()
    emit('created', id, { parent_id: parentId })
    emit('tag_assigned', id, { tag_number: tagNumber })
    return findById(id)!
  }

  // Beams only; stems are voided in the administration.
  function canRemove(itemId: string): boolean {
    return findById(itemId)?.parent_id != null
  }

  /**
   * An unsynced beam just vanishes from the queue. A synced one gets a "voided" event, and whatever is still
   * pending for it (values, photo files) is dropped: the server would only store it on a voided beam.
   * Photos already uploaded stay on the server.
   */
  function removeTimberItem(itemId: string) {
    if (!canRemove(itemId)) {
      throw new Error(`Timber item ${itemId} cannot be removed`)
    }
    if (!hasPendingCreated(itemId)) {
      emit('voided', itemId, {})
    }
    discard(
      (event) => event.timber_item_id === itemId && event.type !== 'voided',
      new Set([itemId]),
    )
  }

  /**
   * Drops one pending entry from the queue. Dropping "created" takes the whole item with it, and a new
   * stem also its new beams (an item that is not synced yet cannot have synced beams).
   */
  function discardEntry(eventId: Uuid) {
    const event = events.value.find((candidate) => candidate.id === eventId)
    if (!event || !isEntry(event)) {
      throw new Error(`Event ${eventId} is not a pending entry`)
    }
    if (event.type !== 'created') {
      discard((candidate) => candidate.id === eventId)
      return
    }
    const itemIds = new Set([
      event.timber_item_id,
      ...events.value
        .filter(
          (candidate) =>
            candidate.type === 'created' && candidate.data.parent_id === event.timber_item_id,
        )
        .map((candidate) => candidate.timber_item_id),
    ])
    discard((candidate) => itemIds.has(candidate.timber_item_id), itemIds)
  }

  function assertRecordable(itemId: string) {
    const item = findById(itemId)
    if (!item) {
      throw new Error(`Unknown timber item ${itemId}`)
    }
    // App-only rule: the server still accepts late events from other devices.
    if (item.has_children) {
      throw new Error(`Timber item ${itemId} is split into beams and read-only`)
    }
  }

  function recordAttribute(itemId: string, attributeId: string, value: AttributeValue) {
    assertRecordable(itemId)
    emit('attribute_recorded', itemId, { attribute_id: attributeId, value })
  }

  /** Keeps a compressed photo on the device and queues the event that records its id for the photo attribute. */
  function addPhoto(itemId: string, attributeId: string, blob: Blob) {
    assertRecordable(itemId)
    const photo: StoredPhoto = {
      id: crypto.randomUUID(),
      timber_item_id: itemId,
      taken_at: new Date().toISOString(),
      size: blob.size,
      blob,
    }
    photos.value.push(photo)
    freshPhotoIds.add(photo.id)
    emit('attribute_recorded', itemId, { attribute_id: attributeId, value: photo.id }, photo)
  }

  const pendingPhotosOf = (itemId: string) =>
    photos.value.filter((photo) => photo.timber_item_id === itemId)

  /** The server already knows these (its snapshot lists the id) and the file is no longer here. */
  function uploadedPhotoCount(itemId: string, attributeId: string): number {
    const records = findById(itemId)?.values[attributeId] ?? []
    return records.filter((record) => !pendingPhotoIds.value.has(String(record.value))).length
  }

  // Once the event reached the server, the id is recorded there and the app cannot take it back.
  const isPhotoQueued = (photoId: string) =>
    events.value.some(
      (event) =>
        isPhotoEvent(event) && event.type === 'attribute_recorded' && event.data.value === photoId,
    )

  function removePhoto(photoId: string) {
    if (!isPhotoQueued(photoId)) {
      throw new Error(`Photo ${photoId} cannot be removed`)
    }
    discard((event) => event.type === 'attribute_recorded' && event.data.value === photoId)
  }

  return {
    snapshot,
    currentUser,
    users,
    attributes,
    items,
    removedBeams,
    events,
    pendingCount,
    photos,
    progress,
    isSyncing,
    isStopping,
    stopSync,
    isEntry,
    lastSyncedAt,
    findByTagNumber,
    findByTag,
    childrenOf,
    nextBeamTagOf,
    isInherited,
    isUnsynced: hasPendingCreated,
    userName,
    inOneTransaction,
    createTimberItem,
    addBeam,
    canRemove,
    removeTimberItem,
    discardEntry,
    recordAttribute,
    addPhoto,
    removePhoto,
    isPhotoQueued,
    pendingPhotosOf,
    uploadedPhotoCount,
    redeemInvite,
    load,
    sync,
    refresh,
  }
})
