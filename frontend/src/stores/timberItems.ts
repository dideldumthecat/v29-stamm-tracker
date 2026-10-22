/**
 * PLACEHOLDER STORE – in-memory fake data, so the screens can be built and clicked through.
 *
 * Replaced later by the real store: snapshot + own pending events → projected state,
 * persisted in IndexedDB (built in learning mode). The public surface (findByTagNumber,
 * createTimberItem, recordAttribute, pendingCount) is what the views rely on, so keep it
 * stable or adjust the views together with it.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  Attribute,
  AttributeValue,
  Snapshot,
  SessionResponse,
  TimberItem,
} from '@/api/contract'
// Fixtures stand in for GET /api/snapshot and POST /api/session until the API client exists.
// JSON imports are typed loosely (type: string instead of 'choice' | …), hence the casts.
import snapshotFixture from '@/api/fixtures/snapshot.json'
import sessionFixture from '@/api/fixtures/session-response.json'

// The app uses the contract types directly (snake_case, as on the wire) – no second model, no mapper.
export type { Attribute, AttributeOption, AttributeValueRecord, TimberItem } from '@/api/contract'
export type User = SessionResponse['user']

export const useTimberItemStore = defineStore('timberItems', () => {
  // structuredClone: tests and hot reload must not mutate the imported fixture.
  const snapshot = structuredClone(snapshotFixture as Snapshot)
  const currentUser: User = { ...(sessionFixture as SessionResponse).user }
  const users = ref<User[]>(snapshot.users)
  const attributes = ref<Attribute[]>(snapshot.attributes)
  const items = ref<TimberItem[]>(snapshot.timber_items)
  // Stands in for the number of events waiting in the sync queue.
  const pendingCount = ref(0)

  // tag_number is a string in the contract ("123", beams "123-A"); the start screen only knows numbers.
  function findByTagNumber(tagNumber: number): TimberItem | undefined {
    return items.value.find((item) => item.tag_number === String(tagNumber))
  }

  function userName(userId: string): string {
    return users.value.find((user) => user.id === userId)?.name ?? 'Unbekannt'
  }

  function createTimberItem(tagNumber: number): TimberItem {
    items.value.push({
      id: crypto.randomUUID(),
      parent_id: null,
      tag_number: String(tagNumber),
      has_children: false,
      created_at: new Date().toISOString(),
      created_by: currentUser.id,
      values: {},
    })
    pendingCount.value++
    // Return the reactive proxy from the array, not the plain object pushed above.
    return items.value[items.value.length - 1]!
  }

  // One store function per event type: this one will emit attribute_recorded (see contract.ts).
  function recordAttribute(itemId: string, attributeId: string, value: AttributeValue) {
    const item = items.value.find((candidate) => candidate.id === itemId)
    if (!item) {
      throw new Error(`Unknown timber item ${itemId}`)
    }
    const record = {
      value,
      recorded_at: new Date().toISOString(),
      user_id: currentUser.id,
      // Placeholder until real events exist; the event id will come from the sync queue.
      event_id: crypto.randomUUID(),
    }
    // Series keep every recording; all other attributes hold exactly one (the current value).
    const isSeries = attributes.value.find((attribute) => attribute.id === attributeId)?.is_series
    item.values[attributeId] = isSeries ? [...(item.values[attributeId] ?? []), record] : [record]
    pendingCount.value++
  }

  return {
    currentUser,
    users,
    attributes,
    items,
    pendingCount,
    findByTagNumber,
    userName,
    createTimberItem,
    recordAttribute,
  }
})
