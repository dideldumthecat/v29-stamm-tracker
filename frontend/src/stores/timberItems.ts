/**
 * PLACEHOLDER STORE – in-memory fake data, so the screens can be built and clicked through.
 *
 * Replaced later by the real store: snapshot + own pending events → projected state,
 * persisted in IndexedDB (built in learning mode). The public surface (findByTagNumber,
 * createTimberItem, recordValue, pendingCount) is what the views rely on, so keep it
 * stable or adjust the views together with it.
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { fakeAttributes, fakeTimberItems, FAKE_CURRENT_USER_NAME } from '@/api/fakeSnapshot'

export interface AttributeOption {
  id: string
  label: string
}

// Only 'choice' for now; the other types from the data model follow attribute by attribute.
export interface Attribute {
  id: string
  name: string
  type: 'choice'
  options: AttributeOption[]
}

export interface RecordedValue {
  optionId: string
  recordedAt: string
  recordedBy: string
}

export interface TimberItem {
  id: string
  tagNumber: number
  createdAt: string
  createdBy: string
  // Latest value per attribute id (what the projection will deliver).
  values: Record<string, RecordedValue>
}

export const useTimberItemStore = defineStore('timberItems', () => {
  // structuredClone: tests and hot reload must not mutate the shared fake data.
  const attributes = ref<Attribute[]>(structuredClone(fakeAttributes))
  const items = ref<TimberItem[]>(structuredClone(fakeTimberItems))
  // Stands in for the number of events waiting in the sync queue.
  const pendingCount = ref(0)

  function findByTagNumber(tagNumber: number): TimberItem | undefined {
    return items.value.find((item) => item.tagNumber === tagNumber)
  }

  function createTimberItem(tagNumber: number): TimberItem {
    const now = new Date().toISOString()
    items.value.push({
      id: crypto.randomUUID(),
      tagNumber,
      createdAt: now,
      createdBy: FAKE_CURRENT_USER_NAME,
      values: {},
    })
    pendingCount.value++
    // Return the reactive proxy from the array, not the plain object pushed above.
    return items.value[items.value.length - 1]!
  }

  function recordValue(itemId: string, attributeId: string, optionId: string) {
    const item = items.value.find((candidate) => candidate.id === itemId)
    if (!item) {
      throw new Error(`Unknown timber item ${itemId}`)
    }
    item.values[attributeId] = {
      optionId,
      recordedAt: new Date().toISOString(),
      recordedBy: FAKE_CURRENT_USER_NAME,
    }
    pendingCount.value++
  }

  return { attributes, items, pendingCount, findByTagNumber, createTimberItem, recordValue }
})
