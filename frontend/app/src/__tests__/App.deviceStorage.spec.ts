import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useTimberItemStore } from '@/stores/timberItems'
import { load, loadDiagnostics } from '@/persistence/database'
import { buttonByText, leaveDialog, mountAt, setupApp } from './appSetup'

vi.mock('virtual:pwa-register/vue', () => import('./appMocks').then((mocks) => mocks.pwaRegister))
vi.mock('@/composables/useUpdateCheck', () =>
  import('./appMocks').then((mocks) => mocks.updateCheck),
)

describe('App: device storage', () => {
  setupApp()
  afterEach(() => vi.restoreAllMocks())
  // Open the connection before a test breaks it: the fake IndexedDB itself uses transaction() while opening.
  beforeEach(async () => void (await load()))

  it('shows a lasting notice on every screen with a way to the sync, until the entries are synced', async () => {
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('Connection to Indexed Database server lost', 'UnknownError')
    })
    const { wrapper, router } = await mountAt('/')
    const store = useTimberItemStore()
    expect(wrapper.text()).not.toContain('Nicht auf dem Gerät gespeichert')

    store.createTimberItem(5)
    await vi.waitFor(() => expect(store.hasUnsaved).toBe(true))
    await flushPromises()
    const notice = wrapper.find('[role="alert"]')
    expect(notice.text()).toContain(
      'Nicht auf dem Gerät gespeichert. App offen lassen und synchronisieren.',
    )

    // Still there on another screen, and no capture is blocked.
    await router.push('/timber-item/6')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"] a').attributes('href')).toBe('/sync')
    await router.push('/sync')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"] a').exists()).toBe(false)
  })

  it('records "Verwerfen" in the leave dialog with counts and no values', async () => {
    const { wrapper } = await mountAt('/timber-item/123')
    await wrapper.find('input[type="month"]').setValue('2026-10')
    await wrapper.find('button[aria-label="Schließen"]').trigger('click')
    await flushPromises()
    expect(leaveDialog().title).toBe('Änderungen verwerfen?')
    buttonByText(/^Verwerfen$/).click()
    await flushPromises()

    const entries = (await loadDiagnostics()).filter((entry) => entry.kind === 'discard')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: 'info',
      context: { tag: '123', values: 1, photos: 0, beams: 0 },
    })
    expect(JSON.stringify(entries[0])).not.toContain('2026-10')
  })
})
