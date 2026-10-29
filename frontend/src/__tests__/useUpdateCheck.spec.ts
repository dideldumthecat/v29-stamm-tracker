import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import {
  APPLY_UPDATE_TIMEOUT_MS,
  applyUpdate,
  checkForUpdateNow,
  MIN_UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_PERIOD_MS,
  startUpdateCheck,
} from '@/composables/useUpdateCheck'

let visibility: DocumentVisibilityState
let online: boolean
let stop: () => void

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('service worker update check', () => {
  let update: ReturnType<typeof vi.fn>
  let registration: { update: typeof update; installing: ServiceWorker | null }

  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    online = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    update = vi.fn().mockResolvedValue(undefined)
    registration = { update, installing: null }
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
    vi.useFakeTimers()
    waiting = Object.assign(new EventTarget(), { state: 'installed' })
    updateServiceWorker = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue()
    reload = vi.fn()
    vi.stubGlobal('location', { reload })
    stop = startUpdateCheck({ waiting } as unknown as ServiceWorkerRegistration)
    applyUpdate(updateServiceWorker)
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
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

  it('reloads after the timeout if nothing happens', () => {
    vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS - 1)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads only once when both happen', () => {
    setState('activated')
    vi.advanceTimersByTime(APPLY_UPDATE_TIMEOUT_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
