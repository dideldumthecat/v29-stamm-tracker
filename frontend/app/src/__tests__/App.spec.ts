import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { signedOut } from './storeSetup'
import { api, ApiError } from '@/api/client'
import {
  installWhenSafe,
  isInstalling,
  isLockStuck,
  reloadFromLock,
} from '@/composables/useUpdateCheck'
import { needRefresh, updateServiceWorker } from './appMocks'
import { leaveDialog, mountAt, setupApp } from './appSetup'

vi.mock('virtual:pwa-register/vue', () => import('./appMocks').then((mocks) => mocks.pwaRegister))
vi.mock('@/composables/useUpdateCheck', () =>
  import('./appMocks').then((mocks) => mocks.updateCheck),
)
vi.mock('@/utils/photo', async (importOriginal) =>
  (await import('./appMocks')).photoUtils(await importOriginal()),
)

describe('App', () => {
  setupApp()

  it('renders the start screen on /', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).toContain('V29 Stamm-Tracker')
  })

  it('renders an unknown timber item with padded tag number', async () => {
    const { wrapper } = await mountAt('/timber-item/42')
    expect(wrapper.text()).toContain('00042')
    expect(wrapper.text()).toContain('Noch nicht erfasst')
    expect(wrapper.text()).toContain('Stamm anlegen & schließen')
  })

  it('shows a known timber item with its recorded value locked', async () => {
    const { wrapper } = await mountAt('/timber-item/123')
    expect(wrapper.text()).toContain('Bereits erfasst')
    expect(wrapper.text()).toContain('Traubeneiche')
    // Holzart is recorded → locked with a pencil button instead of a select.
    expect(wrapper.find('button[aria-label="Holzart ändern"]').exists()).toBe(true)
  })

  it('opens the help page from the start header', async () => {
    const { wrapper, router } = await mountAt('/')
    await wrapper.find('a[aria-label="Hilfe"]').trigger('click')
    // The lazy-loaded view resolves after more than one tick.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('help'))
    await flushPromises()
    expect(wrapper.text()).toContain('App installieren')
    expect(wrapper.text()).toContain('Synchronisieren')
    expect(wrapper.text()).toContain('Speicher geschützt: unbekannt')
  })

  it('credits the author with a link in the help page footer', async () => {
    const { wrapper } = await mountAt('/help')
    const link = wrapper.find('a[href="https://alexandersumma.de"]')
    expect(link.text()).toBe('Alexander Summa')
    expect(link.attributes('target')).toBe('_blank')
  })

  it('redirects invalid tag numbers to the start screen', async () => {
    const { router } = await mountAt('/timber-item/5000')
    expect(router.currentRoute.value.name).toBe('start')
  })

  it('asks before leaving with unsaved changes', async () => {
    const { wrapper, router } = await mountAt('/timber-item/42')
    await wrapper.find('select').setValue(wrapper.findAll('option')[1]!.element.value)
    await wrapper.find('button[aria-label="Schließen"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timber-item')
    expect(leaveDialog()).toEqual({
      title: 'Änderungen verwerfen?',
      intro: 'Noch nicht gespeichert für Stamm 00042:',
      items: ['Holzart: Traubeneiche'],
    })
  })

  describe('automatic update', () => {
    it('has no update hint, however long a new version waits', async () => {
      needRefresh.value = true
      await mountAt('/')
      expect(document.body.textContent).not.toContain('Neue Version')
      expect(document.body.textContent).not.toContain('Aktualisieren')
    })

    it('blocks the whole app while installing, from any screen', async () => {
      const { wrapper } = await mountAt('/timber-item/456')
      const overlay = () => document.body.querySelector('[role="status"].fixed.inset-0')
      expect(overlay()).toBeNull()
      // Vue renders `false` as inert="false", and in the browser the attribute alone means inert.
      expect(wrapper.find('[inert]').exists()).toBe(false)

      isInstalling.value = true
      await flushPromises()
      expect(overlay()?.textContent).toContain('App wird aktualisiert')
      expect(overlay()?.querySelector('button')).toBeNull()
      // The frame is inert (no taps, keyboard or screen reader), the overlay is not part of it.
      expect(document.querySelector('[inert]')?.contains(overlay())).toBe(false)
      expect(document.querySelector('[inert]')?.textContent).toContain('00456')
    })

    it('offers the reload button only once the lock is stuck, and keeps the app behind it inert', async () => {
      await mountAt('/')
      const overlay = () => document.body.querySelector('[role="status"].fixed.inset-0')
      const button = () => overlay()?.querySelector('button')
      isInstalling.value = true
      await flushPromises()
      expect(button()).toBeNull()
      expect(overlay()?.textContent).not.toContain('App schließen')

      isLockStuck.value = true
      await flushPromises()
      expect(button()?.textContent).toContain('Neu laden')
      expect(overlay()?.textContent).toContain(
        'Falls nichts passiert: App schließen und neu öffnen',
      )
      expect(document.querySelector('[inert]')).not.toBeNull()
      expect(document.querySelector('[inert]')?.contains(overlay())).toBe(false)

      button()!.click()
      expect(reloadFromLock).toHaveBeenCalledTimes(1)
    })

    it('hands the waiting state to installWhenSafe', async () => {
      await mountAt('/')
      expect(installWhenSafe).toHaveBeenCalledWith(needRefresh, updateServiceWorker)
    })
  })

  describe('sign-in field', () => {
    it('replaces the number pad while no user is stored and shows the name right after', async () => {
      signedOut()
      const { wrapper } = await mountAt('/')
      expect(wrapper.text()).toContain('Einladungscode')
      expect(wrapper.text()).not.toContain('Alexander')

      await wrapper.find('input#invite-code').setValue('k7qm4xht9rdp')
      expect((wrapper.find('input#invite-code').element as HTMLInputElement).value).toBe(
        'K7QM-4XHT-9RDP',
      )
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('input#invite-code').exists()).toBe(false)
      expect(wrapper.text()).toContain('Alexander')
    })

    it('clears the code and the error with the clear button, shown only while there is a code', async () => {
      signedOut()
      const { wrapper } = await mountAt('/')
      const clearButton = () => wrapper.find('button[aria-label="Code löschen"]')
      expect(clearButton().exists()).toBe(false)

      await wrapper.find('input#invite-code').setValue('Hallo Jana!')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(clearButton().attributes('type')).toBe('button')

      await clearButton().trigger('click')
      expect((wrapper.find('input#invite-code').element as HTMLInputElement).value).toBe('')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(clearButton().exists()).toBe(false)
    })

    it('sends nothing when no code is recognised', async () => {
      signedOut()
      const redeem = vi.spyOn(api, 'redeemInvite')
      const { wrapper } = await mountAt('/')
      await wrapper.find('input#invite-code').setValue('Hallo Jana!')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain('Kein Einladungscode erkannt')
      expect(redeem).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('asks a browser to install the app first, with the form only for the fake API', async () => {
      signedOut()
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').text()).toContain('Bitte zuerst die App installieren')
      expect(wrapper.find('input#invite-code').exists()).toBe(true)
    })

    it('shows no sign-in form in a production browser', async () => {
      signedOut()
      vi.stubEnv('DEV', false)
      vi.stubEnv('VITE_API', '')
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').text()).toContain('Bitte zuerst die App installieren')
      expect(wrapper.find('input#invite-code').exists()).toBe(false)
      vi.unstubAllEnvs()
    })

    it('shows the iPhone install steps in an iPhone browser', async () => {
      signedOut()
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)')
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').text()).toContain('„Zum Home-Bildschirm“')
      vi.restoreAllMocks()
    })

    it('shows no install hint in the installed app', async () => {
      signedOut()
      vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').exists()).toBe(false)
      expect(wrapper.find('input#invite-code').exists()).toBe(true)
      vi.unstubAllGlobals()
    })

    it('reports an invalid or revoked invite', async () => {
      signedOut()
      vi.spyOn(api, 'redeemInvite').mockRejectedValue(new ApiError(401, 'revoked'))
      const { wrapper } = await mountAt('/')
      await wrapper.find('input#invite-code').setValue('K7QM-4XHT-9RDP')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain(
        'Einladung ungültig oder widerrufen – bitte bei V29 nachfragen.',
      )
      vi.restoreAllMocks()
    })
  })
})
