import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Blob as NodeBlob } from 'node:buffer'
import { useTimberItemStore } from '@/stores/timberItems'
import { signedOut } from './storeSetup'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import { checkForUpdateNow } from '@/composables/useUpdateCheck'
import { DUPLICATE_HINT, mountAt, rejectAll, setupApp } from './appSetup'

vi.mock('virtual:pwa-register/vue', () => import('./appMocks').then((mocks) => mocks.pwaRegister))
vi.mock('@/composables/useUpdateCheck', () =>
  import('./appMocks').then((mocks) => mocks.updateCheck),
)
vi.mock('@/utils/photo', async (importOriginal) =>
  (await import('./appMocks')).photoUtils(await importOriginal()),
)

describe('App', () => {
  setupApp()

  describe('sync page', () => {
    beforeEach(() => vi.mocked(checkForUpdateNow).mockClear())
    afterEach(() => vi.restoreAllMocks())

    it('lists rejected duplicate captures on the result and drops them from the queue', async () => {
      useTimberItemStore().createTimberItem(1555)
      rejectAll()
      const { wrapper } = await mountAt('/sync')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()

      expect(wrapper.find('[role="alert"]').text()).toBe(DUPLICATE_HINT)
      expect(useTimberItemStore().events).toEqual([])
    })

    it('lists the removal of a synced beam as a row that can be discarded; the beam is back afterwards', async () => {
      const store = useTimberItemStore()
      store.removeTimberItem(store.findByTag('789-B')!.id)
      const { wrapper } = await mountAt('/sync')
      expect(wrapper.text()).toContain('Balken 00789-B entfernen')
      expect(wrapper.find('h1').text()).toBe('Synchronisierung (1)')

      await wrapper.find('button[aria-label="Eintrag verwerfen"]').trigger('click')
      expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
        'Entfernen von Balken 00789-B verwerfen?',
      )
      ;[...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === 'Verwerfen')!
        .click()
      await flushPromises()

      expect(store.events).toEqual([])
      expect(store.findByTag('789-B')).toBeDefined()
      expect(wrapper.text()).not.toContain('entfernen')
    })

    it('stops through the main button: secondary style while syncing, disabled until it has stopped, then a toast and the entries stay', async () => {
      useTimberItemStore().createTimberItem(1555)
      let stop!: () => void
      vi.spyOn(api, 'sync').mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            stop = () => reject(new ApiError(0, 'aborted'))
          }),
      )
      const { wrapper } = await mountAt('/sync')
      const main = () => wrapper.find('button.h-action')
      expect(main().classes()).toContain('bg-ink')
      await main().trigger('click')
      expect(main().attributes('aria-label')).toBe('Synchronisierung anhalten')
      expect(main().text()).toBe('Anhalten')
      expect(main().classes()).not.toContain('bg-ink')
      expect(main().classes()).toContain('bg-paper')
      expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Daten werden übertragen …')

      await main().trigger('click')
      expect(main().text()).toBe('Wird angehalten …')
      expect(main().attributes('disabled')).toBeDefined()
      expect(main().find('svg').exists()).toBe(false)

      stop()
      await flushPromises()
      expect(main().text()).toContain('Jetzt synchronisieren')
      expect(main().classes()).toContain('bg-ink')
      expect(main().attributes('disabled')).toBeUndefined()
      expect(useToast().current.value).toMatchObject({
        before: 'Angehalten. Deine 1 Eintrag bleibt auf diesem Gerät.',
        kind: 'warning',
      })
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('01555')
    })

    it('uploads no further photo after stopping in the photo phase; the next sync sends the rest and closes the toast', async () => {
      const store = useTimberItemStore()
      const stem = store.createTimberItem(1555)
      const photoAttribute = store.attributes.find((attribute) => attribute.type === 'photo')!.id
      for (let count = 0; count < 3; count++) {
        store.addPhoto(
          stem.id,
          photoAttribute,
          new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob,
        )
      }
      vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
        accepted_event_ids: events.map((event) => event.id),
        rejected: [],
      }))
      const upload = vi
        .spyOn(api, 'uploadPhoto')
        .mockImplementationOnce((_photo, signal) => {
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new ApiError(0, 'aborted')))
          })
        })
        .mockResolvedValue()
      const { wrapper } = await mountAt('/sync')
      const main = () => wrapper.find('button.h-action')

      await main().trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Foto 1 von 3')
      await main().trigger('click')
      await flushPromises()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(useTimberItemStore().photos).toHaveLength(3)
      expect(useToast().current.value?.before).toBe('Angehalten. 3 Fotos bleiben auf diesem Gerät.')

      await main().trigger('click')
      expect(useToast().current.value).toBeNull()
      await flushPromises()
      expect(upload).toHaveBeenCalledTimes(4)
      expect(useTimberItemStore().photos).toHaveLength(0)
    })

    it('stops a sync that was started on an earlier visit of the page: no further photo goes up', async () => {
      const store = useTimberItemStore()
      const stem = store.createTimberItem(1555)
      const photoAttribute = store.attributes.find((attribute) => attribute.type === 'photo')!.id
      for (let count = 0; count < 2; count++) {
        store.addPhoto(
          stem.id,
          photoAttribute,
          new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob,
        )
      }
      vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
        accepted_event_ids: events.map((event) => event.id),
        rejected: [],
      }))
      const upload = vi.spyOn(api, 'uploadPhoto').mockImplementation(
        (_photo, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new ApiError(0, 'aborted')))
          }),
      )
      const { wrapper, router } = await mountAt('/sync')
      const main = () => wrapper.find('button.h-action')
      await main().trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Foto 1 von 2')

      await router.push('/')
      await router.push('/sync')
      await flushPromises()
      expect(main().text()).toBe('Anhalten')
      expect(wrapper.text()).toContain('Foto 1 von 2')

      await main().trigger('click')
      await flushPromises()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(main().text()).toContain('Jetzt synchronisieren')
      expect(useTimberItemStore().photos).toHaveLength(2)
      expect(useToast().current.value?.before).toBe('Angehalten. 2 Fotos bleiben auf diesem Gerät.')
    })

    it('opens the result after a sign-in whose sync rejected something', async () => {
      signedOut()
      const store = useTimberItemStore()
      store.createTimberItem(1555)
      const sync = rejectAll()
      const { wrapper, router } = await mountAt('/')
      await wrapper.find('input#invite-code').setValue('K7QM-4XHT-9RDP')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(sync).toHaveBeenCalled()
      expect(router.currentRoute.value.name).toBe('sync')
      expect(wrapper.find('[role="alert"]').text()).toBe(DUPLICATE_HINT)
    })

    it('lists pending entries and stays on the result after a sync', async () => {
      const store = useTimberItemStore()
      const stem = store.createTimberItem(321)
      store.recordAttribute(stem.id, store.attributes.find((a) => a.name === 'Holzart')!.id, 'x')
      const { wrapper, router } = await mountAt('/sync')
      expect(wrapper.text()).toContain('Synchronisierung (2)')
      expect(wrapper.text()).toContain('Stamm angelegt')
      expect(wrapper.text()).toContain('noch nie')

      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('sync')
      expect(wrapper.text()).toContain('2 Einträge übertragen')
      expect(wrapper.text()).not.toContain('noch nie')
      expect(checkForUpdateNow).toHaveBeenCalledTimes(1)
    })

    it('shows a rejected batch and keeps it', async () => {
      const store = useTimberItemStore()
      store.createTimberItem(321)
      vi.spyOn(api, 'sync').mockRejectedValue(new ApiError(400, 'events[0]: broken'))
      const { wrapper } = await mountAt('/sync')

      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(wrapper.find('[role="alert"]').text()).toContain('abgelehnt (events[0]: broken)')
      expect(wrapper.text()).toContain('Stamm angelegt')
      expect(store.pendingCount).toBe(1)
      expect(checkForUpdateNow).not.toHaveBeenCalled()
    })
  })
})
