import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

async function load() {
  // Fresh module per test: the status is module-level state.
  vi.resetModules()
  return import('@/composables/useStoragePersistence')
}

function stubStorage(storage: Partial<StorageManager> | undefined) {
  vi.stubGlobal('navigator', { ...navigator, storage })
}

describe('useStoragePersistence', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('stays unknown when the API is missing', async () => {
    stubStorage(undefined)
    const { requestStoragePersistence, useStoragePersistence } = await load()
    await requestStoragePersistence()
    expect(useStoragePersistence().isPersisted.value).toBeNull()
  })

  it('does not ask again when already persistent', async () => {
    const persist = vi.fn()
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist })
    const { requestStoragePersistence, useStoragePersistence } = await load()
    await requestStoragePersistence()
    expect(useStoragePersistence().isPersisted.value).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports false when the browser refuses', async () => {
    const persist = vi.fn().mockResolvedValue(false)
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist })
    const { requestStoragePersistence, useStoragePersistence } = await load()
    await requestStoragePersistence()
    expect(persist).toHaveBeenCalledOnce()
    expect(useStoragePersistence().isPersisted.value).toBe(false)
  })
})
