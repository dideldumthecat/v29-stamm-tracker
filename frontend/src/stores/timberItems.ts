/**
 * Displayed state = stored snapshot (as the server sent it) + own pending events laid over it.
 * Every change is an event in the queue, saved on the device right away; the snapshot is only
 * replaced by a sync (or right after sign-in). The views rely on the public surface, so keep it stable or adjust them with it.
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
import { api, type User } from '@/api/client'
import { load as loadStored, save, type StoredState } from '@/persistence/database'
import { useToast } from '@/composables/useToast'
import { nextBeamTag } from '@/utils/tag'

// The app uses the contract types directly (snake_case, as on the wire) – no second model, no mapper.
export type { Attribute, AttributeOption, AttributeValueRecord, TimberItem } from '@/api/contract'
export type { User } from '@/api/client'

// A type, not an interface: it travels as router history state, which needs an index signature.
export type SyncResult = {
  transferred: number
  /**
   * Tags another item already holds. Without keptTag a duplicate capture: what this device recorded on it is gone.
   * With keptTag a rejected tag change: the item keeps that tag.
   */
  rejected: { tagNumber: string; isBeam: boolean; keptTag?: string | null }[]
}

export const useTimberItemStore = defineStore('timberItems', () => {
  const snapshot = ref(api.initialSnapshot())
  // Set by signing in with the invite code; null until then.
  const currentUser = ref<User | null>(api.initialUser())
  const users = computed(() => snapshot.value.users)
  const attributes = computed(() => snapshot.value.attributes)
  // Own events waiting for the sync, in the order they were recorded.
  const events = ref<Event[]>([])
  const lastSyncedAt = ref<Timestamp | null>(null)
  // What the user did, not the wire format: the tag of a new item belongs to "created", a later one is a tag change.
  const isEntryIn = (event: Event, queue: Event[]) =>
    event.type !== 'tag_assigned' ||
    !queue.some(
      (other) => other.type === 'created' && other.timber_item_id === event.timber_item_id,
    )
  const isEntry = (event: Event) => isEntryIn(event, events.value)
  const pendingCount = computed(() => events.value.filter(isEntry).length)

  // A failed write only warns; the change stays in memory until the app is closed.
  function persist(parts: Partial<StoredState>) {
    save(parts).catch(() =>
      useToast().show({ before: 'Speichern auf dem Gerät fehlgeschlagen', kind: 'warning' }),
    )
  }

  function emit<T extends Event['type']>(
    type: T,
    timberItemId: Uuid,
    data: Extract<Event, { type: T }>['data'],
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
    persist({ events: toRaw(events.value) })
    return event
  }

  // Filter the raw array: filtering the reactive one yields proxies, which IndexedDB cannot store.
  function dropEvents(isDropped: (event: Event) => boolean): Event[] {
    events.value = toRaw(events.value).filter((event) => !isDropped(event))
    return toRaw(events.value)
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

    for (const event of events.value) {
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
          voided_beam_tags: [],
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
    return [...byId.values()]
  })

  const findById = (id: string | null) => items.value.find((item) => item.id === id)

  /** Called once before the app mounts: the router guards already need the stored state. */
  async function load() {
    const stored = await loadStored()
    currentUser.value = stored.user ?? currentUser.value
    snapshot.value = stored.snapshot ?? snapshot.value
    events.value = stored.events
    lastSyncedAt.value = stored.lastSyncedAt
  }

  /**
   * Own events up, then the snapshot down. Throws ApiError on failure; the queue keeps whatever the
   * server has not confirmed. Returns how many entries (as counted by pendingCount) were transferred,
   * and the tags the server rejected: duplicate captures are dropped from the device, rejected tag changes only.
   */
  async function sync(): Promise<SyncResult> {
    // Events recorded while the sync runs are not part of this batch and stay in the queue.
    const batch = [...toRaw(events.value)]
    const response = batch.length > 0 ? await api.sync(batch) : null
    const accepted = new Set(response?.accepted_event_ids)
    const rejectedEvents = new Set(response?.rejected.map((entry) => entry.event_id))
    // An item is gone only if its creation was rejected; a rejected tag change keeps the item with its previous tag.
    const rejectedItems = new Set(
      batch
        .filter((event) => event.type === 'created' && rejectedEvents.has(event.id))
        .map((event) => event.timber_item_id),
    )
    const rejectedEntries = response?.rejected ?? []
    const duplicateTags = rejectedEntries
      .filter((entry) => rejectedItems.has(entry.timber_item_id))
      .map((entry) => entry.tag_number)
    const tagChanges = rejectedEntries.filter((entry) => !rejectedItems.has(entry.timber_item_id))
    // Read before the queue changes: afterwards the rejected items are gone.
    const rejected: SyncResult['rejected'] = [...new Set(duplicateTags)].map((tagNumber) => ({
      tagNumber,
      isBeam: items.value.some(
        (item) => rejectedItems.has(item.id) && item.tag_number === tagNumber && item.parent_id,
      ),
    }))
    // Later events on a rejected item would only be rejected with it next time.
    await downloadSnapshot(
      (event) =>
        accepted.has(event.id) ||
        rejectedEvents.has(event.id) ||
        rejectedItems.has(event.timber_item_id),
    )
    markSynced()
    // Read after the download: the tag the item keeps is the server's.
    for (const entry of tagChanges) {
      const item = findById(entry.timber_item_id)
      rejected.push({
        tagNumber: entry.tag_number,
        isBeam: item?.parent_id != null,
        keptTag: item?.tag_number ?? null,
      })
    }
    return {
      transferred: batch.filter((event) => isEntryIn(event, batch) && accepted.has(event.id))
        .length,
      rejected,
    }
  }

  async function downloadSnapshot(isDone: (event: Event) => boolean = () => false) {
    const fresh = await api.loadSnapshot()
    // Accepted events leave the queue only together with the snapshot that contains them, so a failed
    // download hides nothing. Resending them next time is harmless: the server ignores known ids.
    snapshot.value = fresh
    persist({ snapshot: fresh, events: dropEvents(isDone) })
  }

  function markSynced() {
    lastSyncedAt.value = new Date().toISOString()
    persist({ lastSyncedAt: lastSyncedAt.value })
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

  function childrenOf(itemId: string): TimberItem[] {
    return items.value.filter((item) => item.parent_id === itemId).map(withInherited)
  }

  // undefined parent = stem not created yet, so no beams either. A removed unsynced beam frees its letter,
  // a voided one does not. A snapshot stored before voided_beam_tags existed lacks it until the next sync.
  function nextBeamTagOf(parent: TimberItem | undefined, parentTag: string): string | null {
    const beamTags = parent
      ? [
          ...childrenOf(parent.id).map((beam) => beam.tag_number),
          ...(parent.voided_beam_tags ?? []),
        ]
      : []
    return nextBeamTag(parentTag, beamTags)
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
    // Attributes come only with the snapshot; without them nothing can be recorded offline.
    // Failing here is fine: the sign-in stands and the next sync fetches it.
    try {
      await downloadSnapshot()
    } catch {
      return
    }
    // With pending events the device is not in sync with the server yet.
    if (events.value.length === 0) {
      markSynced()
    }
  }

  function createTimberItem(tagNumber: number): TimberItem {
    return create(String(tagNumber), null)
  }

  // Beams are added one at a time; the parent is split from then on and accepts no more recordings.
  function addBeam(parentId: string): TimberItem {
    const parent = findById(parentId)
    if (!parent?.tag_number || parent.parent_id) {
      throw new Error(`Cannot add a beam to timber item ${parentId}`)
    }
    const tag = nextBeamTagOf(parent, parent.tag_number)
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

  // Once synced, a beam can only be voided in the administration – the app sends no void event.
  function canRemove(itemId: string): boolean {
    return hasPendingCreated(itemId) && findById(itemId)?.parent_id != null
  }

  function removeTimberItem(itemId: string) {
    if (!canRemove(itemId)) {
      throw new Error(`Timber item ${itemId} cannot be removed`)
    }
    persist({ events: dropEvents((event) => event.timber_item_id === itemId) })
  }

  /** Another item that holds the tag, in the snapshot or through pending events. */
  function tagHolder(tagNumber: number, exceptId: string): TimberItem | undefined {
    return items.value.find((item) => item.tag_number === String(tagNumber) && item.id !== exceptId)
  }

  // Same tag again is no change. Also a beam gets a plain tag: its new plaque.
  function assignTag(itemId: string, tagNumber: number) {
    const item = findById(itemId)
    if (!item || item.has_children) {
      throw new Error(`Timber item ${itemId} is unknown or split into beams`)
    }
    if (tagHolder(tagNumber, itemId)) {
      throw new Error(`Tag ${tagNumber} is taken`)
    }
    if (item.tag_number !== String(tagNumber)) {
      emit('tag_assigned', itemId, { tag_number: String(tagNumber) })
    }
  }

  function recordAttribute(itemId: string, attributeId: string, value: AttributeValue) {
    const item = findById(itemId)
    if (!item) {
      throw new Error(`Unknown timber item ${itemId}`)
    }
    // App-only rule: the server still accepts late events from other devices.
    if (item.has_children) {
      throw new Error(`Timber item ${itemId} is split into beams and read-only`)
    }
    emit('attribute_recorded', itemId, { attribute_id: attributeId, value })
  }

  return {
    snapshot,
    currentUser,
    users,
    attributes,
    items,
    events,
    pendingCount,
    isEntry,
    lastSyncedAt,
    findByTagNumber,
    findByTag,
    childrenOf,
    nextBeamTagOf,
    isInherited,
    userName,
    createTimberItem,
    addBeam,
    canRemove,
    removeTimberItem,
    recordAttribute,
    tagHolder,
    assignTag,
    redeemInvite,
    load,
    sync,
  }
})
