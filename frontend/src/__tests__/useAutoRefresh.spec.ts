import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTimberItemStore } from '@/stores/timberItems'
import { MIN_REFRESH_INTERVAL_MS, startAutoRefresh } from '@/composables/useAutoRefresh'
import { ApiError } from '@/api/client'

let visibility: DocumentVisibilityState
let online: boolean
let stop: () => void

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('automatic refresh', () => {
  let refresh: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    visibility = 'visible'
    online = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    refresh = vi.fn().mockResolvedValue(undefined)
    useTimberItemStore().refresh = refresh as never
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes on start', () => {
    stop = startAutoRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes when the app becomes visible again, after the minimum interval', () => {
    stop = startAutoRefresh()
    setVisibility('hidden')
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS)
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('ignores becoming hidden', () => {
    stop = startAutoRefresh()
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS)
    setVisibility('hidden')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not flood: returns within the minimum interval do nothing', () => {
    stop = startAutoRefresh()
    for (let i = 0; i < 5; i++) {
      setVisibility('hidden')
      setVisibility('visible')
    }
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS - 1)
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('counts a failed attempt for the interval and stays silent', async () => {
    refresh.mockRejectedValue(new ApiError(0, 'offline'))
    stop = startAutoRefresh()
    await vi.advanceTimersByTimeAsync(1000)
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a signed-in user', () => {
    useTimberItemStore().currentUser = null
    stop = startAutoRefresh()
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS)
    setVisibility('visible')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does nothing offline and does not use up the interval', () => {
    online = false
    stop = startAutoRefresh()
    setVisibility('visible')
    expect(refresh).not.toHaveBeenCalled()
    online = true
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('stops listening after cleanup', () => {
    stop = startAutoRefresh()
    stop()
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS)
    setVisibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
