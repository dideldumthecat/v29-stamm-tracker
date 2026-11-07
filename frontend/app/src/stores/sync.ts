/**
 * The manual sync (own events up, snapshot down, then the photos) and the automatic download.
 * Holds no state of its own: it works on the store's refs, so the store stays the single owner.
 */
import { toRaw, type ComputedRef, type Ref } from 'vue'
import type { Event, Snapshot, TimberItem, Timestamp, Uuid } from '@v29/shared/contract'
import { api, ApiError, describeFailure, type User } from '@/api/client'
import type { PhotoChanges, StoredPhoto, StoredState } from '@/persistence/database'
import { record } from '@/diagnostics/record'
import { sendDiagnostics } from '@/diagnostics/send'
import { SYNC_TIMEOUT_MS } from '@/config/constants'

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

export interface SyncContext {
  snapshot: Ref<Snapshot>
  currentUser: Ref<User | null>
  events: Ref<Event[]>
  photos: Ref<StoredPhoto[]>
  lastSyncedAt: Ref<Timestamp | null>
  progress: Ref<SyncProgress | null>
  isSyncing: Ref<boolean>
  isStopping: Ref<boolean>
  items: ComputedRef<TimberItem[]>
  pendingCount: ComputedRef<number>
  isEntry: (event: Event) => boolean
  isPhotoEvent: (event: Event) => boolean
  persist: (parts: Partial<StoredState>, photoChanges?: PhotoChanges) => void
  dropEvents: (isDropped: (event: Event) => boolean) => Event[]
  dropPhotos: (isDropped: (photo: StoredPhoto) => boolean) => Uuid[]
}

export function createSync({
  snapshot,
  currentUser,
  events,
  photos,
  lastSyncedAt,
  progress,
  isSyncing,
  isStopping,
  items,
  pendingCount,
  isEntry,
  isPhotoEvent,
  persist,
  dropEvents,
  dropPhotos,
}: SyncContext) {
  let syncController: AbortController | undefined
  // Captured since this start: the blob is still the one from the camera, not read back from IndexedDB (diagnostics only).
  const freshPhotoIds = new Set<Uuid>()
  const photoAttempts = new Map<Uuid, number>()

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

  return { sync, stopSync, refresh, markPhotoFresh: (id: Uuid) => freshPhotoIds.add(id) }
}
