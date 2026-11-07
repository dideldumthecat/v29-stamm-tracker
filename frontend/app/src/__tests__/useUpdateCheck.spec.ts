import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { nextTick } from 'vue'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import {
  APPLY_UPDATE_TIMEOUT_MS,
  applyUpdate,
  checkForUpdateNow,
  installWhenSafe,
  isInstalling,
  isLockStuck,
  LOCK_ESCAPE_MS,
  reloadFromLock,
  MIN_UPDATE_CHECK_INTERVAL_MS,
  RELOAD_GRACE_MS,
  UPDATE_CHECK_PERIOD_MS,
  startUpdateCheck,
} from '@/composables/useUpdateCheck'
import { save } from '@/persistence/database'
import { holdSync } from './storeSetup'

// Pass-through spy: a test can hold back a write to the device.
vi.mock('@/persistence/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/persistence/database')>()
  return { ...original, save: vi.fn(original.save) }
})

let visibility: DocumentVisibilityState
let online: boolean
let stop: () => void

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('service worker update check', () => {
  let update: ReturnType<typeof vi.fn>
  let registration: {
    update: typeof update
    installing: ServiceWorker | null
    addEventListener: ReturnType<typeof vi.fn>
    waiting: ServiceWorker | null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    online = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    update = vi.fn().mockResolvedValue(undefined)
    registration = { update, installing: null, addEventListener: vi.fn(), waiting: null }
    stop = startUpdateCheck(registration as unknown as ServiceWorkerRegistration)
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not check on start', () => {
    expect(update).not.toHaveBeenCalled()
  })

  it('checks when the app returns to the foreground', () => {
    setVisibility('visible')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('ignores becoming hidden', () => {
    setVisibility('hidden')
    expect(update).not.toHaveBeenCalled()
  })

  it('does not flood: returns within the minimum interval do nothing', () => {
    setVisibility('visible')
    vi.advanceTimersByTime(MIN_UPDATE_CHECK_INTERVAL_MS - 1)
    setVisibility('visible')
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    setVisibility('visible')
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('checks every 60 minutes while open', () => {
    vi.advanceTimersByTime(UPDATE_CHECK_PERIOD_MS - 1)
    expect(update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_CHECK_PERIOD_MS)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('does nothing offline and does not use up the interval', () => {
    online = false
    setVisibility('visible')
    vi.advanceTimersByTime(UPDATE_CHECK_PERIOD_MS)
    expect(update).not.toHaveBeenCalled()
    online = true
    setVisibility('visible')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('does nothing while a new worker is installing', () => {
    registration.installing = {} as ServiceWorker
    setVisibility('visible')
    vi.advanceTimersByTime(UPDATE_CHECK_PERIOD_MS)
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a failing update() and counts it for the interval', async () => {
    update.mockRejectedValue(new TypeError('Failed to fetch'))
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(1000)
    setVisibility('visible')
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('checks on demand, ignoring the minimum interval', async () => {
    setVisibility('visible')
    await checkForUpdateNow()
    await checkForUpdateNow()
    expect(update).toHaveBeenCalledTimes(3)
  })

  it('does not check on demand offline or while a new worker is installing', async () => {
    online = false
    await checkForUpdateNow()
    online = true
    registration.installing = {} as ServiceWorker
    await checkForUpdateNow()
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a failing update() on demand', async () => {
    update.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(checkForUpdateNow()).resolves.toBeUndefined()
  })

  it('does nothing on demand without a registration', async () => {
    stop()
    await expect(checkForUpdateNow()).resolves.toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  it('removes listener and timer on cleanup', () => {
    stop()
    setVisibility('visible')
    vi.advanceTimersByTime(UPDATE_CHECK_PERIOD_MS)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('applying a waiting update', () => {
  let waiting: EventTarget & { state: string }
  let updateServiceWorker: Mock<(reloadPage?: boolean) => Promise<void>>
  let reload: ReturnType<typeof vi.fn>
  let stop: () => void

  function setState(state: string) {
    waiting.state = state
    waiting.dispatchEvent(new Event('statechange'))
  }

  beforeEach(() => {
    isInstalling.value = false
    isLockStuck.value = false
    vi.useFakeTimers()
    waiting = Object.assign(new EventTarget(), { state: 'installed' })
    updateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue()
    reload = vi.fn()
    vi.stubGlobal('location', { reload })
    stop = startUpdateCheck({
      waiting,
      addEventListener: vi.fn(),
    } as unknown as ServiceWorkerRegistration)
    applyUpdate(updateServiceWorker)
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('blocks the app from the start of the installation', () => {
    expect(isInstalling.value).toBe(true)
  })

  it('asks the plugin to activate the worker', () => {
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when the worker reports activated', () => {
    setState('activating')
    expect(reload).not.toHaveBeenCalled()
    setState('activated')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads after the timeout if nothing happens, once the report had a moment to be stored', () => {
    vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS + RELOAD_GRACE_MS - 1)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  describe('lock escape', () => {
    it('shows nothing during the normal installation', () => {
      vi.advanceTimersByTime(LOCK_ESCAPE_MS - 1)
      expect(isLockStuck.value).toBe(false)
    })

    it('shows the way out after 10 seconds', () => {
      vi.advanceTimersByTime(LOCK_ESCAPE_MS)
      expect(isLockStuck.value).toBe(true)
    })

    it('shows it at once on return from the background if the time is up', () => {
      // The clock moves on, but the frozen timer never fires.
      vi.setSystemTime(Date.now() + LOCK_ESCAPE_MS)
      expect(isLockStuck.value).toBe(false)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(isLockStuck.value).toBe(true)
    })

    it('does not show it on return from the background before the time is up', () => {
      vi.setSystemTime(Date.now() + LOCK_ESCAPE_MS - 1)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(isLockStuck.value).toBe(false)
    })

    it('reloads on the button even after the timeout fallback has used up its own reload', () => {
      vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS + RELOAD_GRACE_MS)
      expect(reload).toHaveBeenCalledTimes(1)
      reloadFromLock()
      vi.advanceTimersByTime(RELOAD_GRACE_MS)
      expect(reload).toHaveBeenCalledTimes(2)
    })
  })

  it('reloads only once when both happen', () => {
    setState('activated')
    vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS + RELOAD_GRACE_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('installing an update in a safe state', () => {
  let needRefresh: ReturnType<typeof ref<boolean>>
  let updateServiceWorker: Mock<(reloadPage?: boolean) => Promise<void>>
  let stop: () => void

  function start(waiting: boolean) {
    needRefresh.value = waiting
    stop = installWhenSafe(needRefresh as never, updateServiceWorker)
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    isInstalling.value = false
    needRefresh = ref(false)
    updateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue()
    vi.stubGlobal('location', { reload: vi.fn() })
  })

  afterEach(() => {
    stop()
    vi.unstubAllGlobals()
  })

  it('installs at once when the update already waits at start', () => {
    start(true)
    expect(isInstalling.value).toBe(true)
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('installs at once when an update arrives in a safe state', async () => {
    start(false)
    needRefresh.value = true
    await nextTick()
    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a waiting update', async () => {
    start(false)
    useTimberItemStore().setDraftOpen(true)
    useTimberItemStore().setDraftOpen(false)
    await nextTick()
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('waits while a draft is open and installs when it is closed', async () => {
    const store = useTimberItemStore()
    store.setDraftOpen(true)
    start(true)
    await nextTick()
    expect(updateServiceWorker).not.toHaveBeenCalled()
    expect(isInstalling.value).toBe(false)
    store.setDraftOpen(false)
    await nextTick()
    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
  })

  it('waits while a sync runs and installs when it has ended', async () => {
    // The real write would hang: an earlier test opened the database under fake timers. Writes have a test of their own.
    vi.mocked(save).mockResolvedValue()
    const finishSync = holdSync()
    start(true)
    await nextTick()
    expect(updateServiceWorker).not.toHaveBeenCalled()
    // The sync ends with a write to the device, which the update waits for too.
    await finishSync()
    await vi.waitFor(() => expect(updateServiceWorker).toHaveBeenCalledTimes(1))
    vi.mocked(save).mockRestore()
  })

  it('waits while a slow write to the device runs and installs only after it ended', async () => {
    // Every write is held back until the test lets it through; `written` is what reached the device.
    const written: string[] = []
    const releases: (() => void)[] = []
    vi.mocked(save).mockImplementation(
      (parts) =>
        new Promise<void>((resolve) =>
          releases.push(() => {
            written.push(...(parts.events ?? []).map((event) => event.timber_item_id))
            resolve()
          }),
        ),
    )
    const store = useTimberItemStore()
    const stem = store.createTimberItem(1555)
    start(true)
    await nextTick()
    expect(updateServiceWorker).not.toHaveBeenCalled()

    releases.forEach((release) => release())
    await vi.waitFor(() => expect(updateServiceWorker).toHaveBeenCalledTimes(1))
    expect(written).toContain(stem.id)
    vi.mocked(save).mockRestore()
  })

  it('installs only once', async () => {
    const store = useTimberItemStore()
    start(true)
    store.setDraftOpen(true)
    store.setDraftOpen(false)
    await nextTick()
    expect(updateServiceWorker).toHaveBeenCalledTimes(1)
  })
})
