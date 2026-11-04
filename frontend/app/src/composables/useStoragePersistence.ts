import { readonly, ref } from 'vue'

// true = browser won't evict our IndexedDB under storage pressure; null = unknown (API missing or failed).
const isPersisted = ref<boolean | null>(null)

// Unsynced events live only in IndexedDB, so ask once per start to keep them from being evicted.
// A refusal is not an error: the app works the same, the help page just shows the status.
export async function requestStoragePersistence() {
  const storage = navigator.storage
  if (!storage?.persisted || !storage.persist) return
  try {
    isPersisted.value = (await storage.persisted()) || (await storage.persist())
  } catch {
    isPersisted.value = null
  }
}

export function useStoragePersistence() {
  return { isPersisted: readonly(isPersisted) }
}
