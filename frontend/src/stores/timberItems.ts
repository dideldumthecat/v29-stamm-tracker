/**
 * PLACEHOLDER STORE – in-memory fake data, so the screens can be built and clicked through.
 *
 * Replaced later by the real store: snapshot + own pending events → projected state,
 * persisted in IndexedDB (built in learning mode). The public surface (findByTagNumber, findByTag,
 * childrenOf, beamCount, nextBeamTagOf, isInherited, createTimberItem, addBeam, canRemove, removeTimberItem,
 * recordAttribute, pendingCount) is what the views rely on, so keep it stable or adjust the views together with it.
 *
 * `items` holds own values only; inherited values are added at read time (withInherited).
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Attribute, AttributeValueRecord, AttributeValue, TimberItem } from '@/api/contract'
import { api, type User } from '@/api/client'
import { nextBeamTag } from '@/utils/tag'

// The app uses the contract types directly (snake_case, as on the wire) – no second model, no mapper.
export type { Attribute, AttributeOption, AttributeValueRecord, TimberItem } from '@/api/contract'
export type { User } from '@/api/client'

export const useTimberItemStore = defineStore('timberItems', () => {
  const snapshot = api.initialSnapshot()
  // Set by the invite link; null until then.
  const currentUser = ref<User | null>(api.initialUser())
  const users = ref<User[]>(snapshot.users)
  const attributes = ref<Attribute[]>(snapshot.attributes)
  const items = ref<TimberItem[]>(snapshot.timber_items)
  // Stands in for the number of events waiting in the sync queue.
  const pendingCount = ref(0)
  // Items created in this session with their number of events: still in the queue, so removable.
  // Placeholder for "has unsynced created event".
  const unsynced = ref(new Map<string, number>())
  // Unsynced beams removed in this session, still counted for the next letter.
  // TODO: the real store must keep this trace persistently (the removed events never reach the server).
  const removedBeams = ref<TimberItem[]>([])

  const findById = (id: string | null) => items.value.find((item) => item.id === id)
  const lastEventId = (records: AttributeValueRecord[] | undefined) =>
    records?.slice(-1)[0]?.event_id

  // The snapshot delivers beams with their inherited values (as timber_item_state does).
  // Strip those, so a parent changed offline is followed by its beams.
  for (const item of items.value) {
    const parent = findById(item.parent_id)
    for (const attributeId of Object.keys(item.values)) {
      const own = lastEventId(item.values[attributeId])
      if (parent && own !== undefined && own === lastEventId(parent.values[attributeId])) {
        delete item.values[attributeId]
      }
    }
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

  // Every beam ever created on this parent, removed unsynced ones included: letters are never reused.
  function beamCount(parentId: string): number {
    return [...items.value, ...removedBeams.value].filter((item) => item.parent_id === parentId)
      .length
  }

  // undefined parent = stem not created yet, so no beams either.
  function nextBeamTagOf(parent: TimberItem | undefined, parentTag: string): string | null {
    return nextBeamTag(parentTag, parent ? beamCount(parent.id) : 0)
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
    parent.has_children = true
    return create(tag, parentId)
  }

  function create(tagNumber: string, parentId: string | null): TimberItem {
    const id = crypto.randomUUID()
    items.value.push({
      id,
      parent_id: parentId,
      tag_number: tagNumber,
      has_children: false,
      created_at: new Date().toISOString(),
      created_by: currentUser.value?.id ?? '',
      values: {},
    })
    pendingCount.value++
    unsynced.value.set(id, 1)
    // Return the reactive proxy from the array, not the plain object pushed above.
    return items.value[items.value.length - 1]!
  }

  // Once synced, a beam can only be voided in the administration – the app sends no void event.
  function canRemove(itemId: string): boolean {
    return unsynced.value.has(itemId) && findById(itemId)?.parent_id != null
  }

  function removeTimberItem(itemId: string) {
    if (!canRemove(itemId)) {
      throw new Error(`Timber item ${itemId} cannot be removed`)
    }
    const beam = findById(itemId)!
    const parentId = beam.parent_id
    removedBeams.value.push(beam)
    items.value = items.value.filter((item) => item.id !== itemId)
    pendingCount.value -= unsynced.value.get(itemId)!
    unsynced.value.delete(itemId)
    const parent = findById(parentId)
    if (parent) {
      parent.has_children = items.value.some((item) => item.parent_id === parentId)
    }
  }

  // One store function per event type: this one will emit attribute_recorded (see contract.ts).
  function recordAttribute(itemId: string, attributeId: string, value: AttributeValue) {
    const item = items.value.find((candidate) => candidate.id === itemId)
    if (!item) {
      throw new Error(`Unknown timber item ${itemId}`)
    }
    // App-only rule: the server still accepts late events from other devices.
    if (item.has_children) {
      throw new Error(`Timber item ${itemId} is split into beams and read-only`)
    }
    const record = {
      value,
      recorded_at: new Date().toISOString(),
      user_id: currentUser.value?.id ?? '',
      // Placeholder until real events exist; the event id will come from the sync queue.
      event_id: crypto.randomUUID(),
    }
    // Series keep every recording; all other attributes hold exactly one (the current value).
    const isSeries = attributes.value.find((attribute) => attribute.id === attributeId)?.is_series
    item.values[attributeId] = isSeries ? [...(item.values[attributeId] ?? []), record] : [record]
    pendingCount.value++
    if (unsynced.value.has(itemId)) {
      unsynced.value.set(itemId, unsynced.value.get(itemId)! + 1)
    }
  }

  return {
    currentUser,
    users,
    attributes,
    items,
    pendingCount,
    findByTagNumber,
    findByTag,
    childrenOf,
    beamCount,
    nextBeamTagOf,
    isInherited,
    userName,
    createTimberItem,
    addBeam,
    canRemove,
    removeTimberItem,
    recordAttribute,
    redeemInvite,
  }
})
