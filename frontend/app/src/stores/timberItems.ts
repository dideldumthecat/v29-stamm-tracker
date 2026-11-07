/**
 * Displayed state = stored snapshot (as the server sent it) + own pending events laid over it.
 * Every change is an event in the queue, saved on the device right away; the snapshot is only
 * replaced by a sync, an automatic refresh or right after sign-in. The views rely on the public surface, so keep it stable or adjust them with it.
 *
 * `items` holds own values only; inherited values are added at read time (withInherited).
 */
import { computed, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import type { AttributeValue, Event, TimberItem, Timestamp, Uuid } from '@v29/shared/contract'
import { api, type User } from '@/api/client'
import {
  load as loadStored,
  save,
  type PhotoChanges,
  type StoredPhoto,
  type StoredState,
} from '@/persistence/database'
import { useToast } from '@/composables/useToast'
import { sendDiagnostics, setDiagnosticsSignedIn } from '@/diagnostics/send'
import {
  childrenOf as projectChildrenOf,
  isInherited as projectIsInherited,
  nextBeamTagOf as projectNextBeamTagOf,
  projectItems,
  removedBeams as projectRemovedBeams,
  withInherited as projectWithInherited,
} from './projection'
import { createSync, type SyncProgress } from './sync'

// The app uses the contract types directly (snake_case, as on the wire) – no second model, no mapper.
export type {
  Attribute,
  AttributeOption,
  AttributeValueRecord,
  TimberItem,
} from '@v29/shared/contract'
export type { User } from '@/api/client'
export type { StoredPhoto } from '@/persistence/database'
export type { SyncProgress, SyncResult } from './sync'

export const useTimberItemStore = defineStore('timberItems', () => {
  const snapshot = ref(api.initialSnapshot())
  // Set by signing in with the invite code; null until then.
  const currentUser = ref<User | null>(api.initialUser())
  // Sync, so that the send right after a sign-in already sees it.
  watch(currentUser, (user) => setDiagnosticsSignedIn(!!user), { immediate: true, flush: 'sync' })
  const users = computed(() => snapshot.value.users)
  const attributes = computed(() => snapshot.value.attributes)
  // Own events waiting for the sync, in the order they were recorded.
  const events = ref<Event[]>([])
  const lastSyncedAt = ref<Timestamp | null>(null)
  // What the user did, not the wire format: the tag always belongs to the "created" of its item.
  const isEntry = (event: Event) => event.type !== 'tag_assigned'
  // Photos not uploaded yet; the blobs live in their own object store, the event with the photo id in the queue.
  const photos = ref<StoredPhoto[]>([])
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
  // Set by the timber item screen while it holds input that exists only in memory (fields, photos, beams, a camera
  // that has not delivered yet). A reload would drop it, and a download would change attributes under it.
  const isDraftOpen = ref(false)
  // Writes to the device that have started and not yet ended (successfully or not). The screen changes before the
  // write is through, and a reload in between aborts it.
  const pendingWrites = ref(0)
  // The single definition of "a reload loses or interrupts nothing"; the automatic app update waits for it.
  // A photo upload is part of the sync.
  const isSafeToReload = computed(
    () => !isDraftOpen.value && !isSyncing.value && pendingWrites.value === 0,
  )

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
    pendingWrites.value++
    ;(hasPhotoChanges ? save(parts, photoChanges) : save(parts))
      .catch(() =>
        useToast().show({ before: 'Speichern auf dem Gerät fehlgeschlagen', kind: 'warning' }),
      )
      // A failed write counts as ended too, or the update would wait forever.
      .finally(() => pendingWrites.value--)
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

  const items = computed(() =>
    projectItems(snapshot.value, events.value, attributes.value, currentUser.value?.id ?? ''),
  )
  const removedBeams = computed(() => projectRemovedBeams(snapshot.value, events.value))

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

  const { sync, stopSync, refresh, markPhotoFresh } = createSync({
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
  })

  const withInherited = (item: TimberItem) =>
    projectWithInherited(item, items.value, attributes.value)

  // tag_number is a string in the contract ("123", beams "123-A"); the start screen only knows numbers.
  function findByTagNumber(tagNumber: number): TimberItem | undefined {
    return findByTag(String(tagNumber))
  }

  function findByTag(tag: string): TimberItem | undefined {
    const item = items.value.find((candidate) => candidate.tag_number === tag)
    return item && withInherited(item)
  }

  const childrenOf = (itemId: string) => projectChildrenOf(itemId, items.value, attributes.value)

  const nextBeamTagOf = (parent: TimberItem | undefined, parentTag: string, draftTags?: string[]) =>
    projectNextBeamTagOf(parent, parentTag, items.value, draftTags)

  const isInherited = (itemId: string, attributeId: string) =>
    projectIsInherited(itemId, attributeId, items.value, attributes.value)

  // Own name before the first sync: the snapshot does not know this user yet.
  function userName(userId: string): string {
    const user = [...users.value, currentUser.value].find((candidate) => candidate?.id === userId)
    return user?.name ?? 'Unbekannt'
  }

  async function redeemInvite(token: string) {
    currentUser.value = (await api.redeemInvite(token)).user
    persist({ user: toRaw(currentUser.value) })
    // Reports kept back until now (or after a 401) can go.
    void sendDiagnostics()
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

  // A removed beam comes back with its tag; that is impossible once a newer beam took the tag (the server rejects duplicates).
  // Null if nothing is in the way, else the tag in question. `items` leaves out removed beams, so only live ones count.
  function tagTakenOver(event: Event): string | null {
    const tag =
      event.type === 'voided' ? removedBeams.value.get(event.timber_item_id)?.tag_number : null
    return tag && items.value.some((item) => item.tag_number === tag) ? tag : null
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
    const taken = tagTakenOver(event)
    if (taken) {
      throw new Error(`Tag ${taken} is taken by a new beam, the removal cannot be discarded`)
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
    markPhotoFresh(photo.id)
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
    isDraftOpen,
    isSafeToReload,
    pendingWrites,
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
    tagTakenOver,
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
