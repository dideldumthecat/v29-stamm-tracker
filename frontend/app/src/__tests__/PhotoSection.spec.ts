import { afterEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { loadDiagnostics } from '@/persistence/database'
import PhotoSection from '@/components/PhotoSection.vue'
import type { Attribute, StoredPhoto } from '@/stores/timberItems'

URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

const attribute = { name: 'Fotos', description: '' } as Attribute
const photo = (id: string): StoredPhoto => ({
  id,
  timber_item_id: 'item',
  taken_at: '2026-10-30T10:00:00.000Z',
  size: 1,
  blob: new Blob(['x']),
})
const mountSection = (props: Partial<InstanceType<typeof PhotoSection>['$props']> = {}) =>
  mount(PhotoSection, {
    props: { attribute, pending: [], uploadedCount: 0, canCapture: true, busy: false, ...props },
  })

describe('photo section', () => {
  const buttonLabels = (wrapper: ReturnType<typeof mountSection>) =>
    wrapper.findAll('button:not([aria-label="Foto entfernen"])').map((button) => button.text())
  const heading = (wrapper: ReturnType<typeof mountSection>) => wrapper.find('h2').text()

  it('without any photo shows camera and gallery side by side, no stack, no count', () => {
    const wrapper = mountSection()
    expect(buttonLabels(wrapper)).toEqual(['Foto aufnehmen', 'Aus Galerie'])
    expect(wrapper.find('.col-span-4').exists()).toBe(true)
    expect(wrapper.find('.col-span-3').exists()).toBe(false)
    expect(wrapper.find('[role="img"]').exists()).toBe(false)
    expect(heading(wrapper)).toBe('Fotos')
  })

  it('with only a stack puts the buttons beside it in the same row', async () => {
    const wrapper = mountSection({ uploadedCount: 12 })
    expect(wrapper.find('[role="img"]').text()).toBe('12')
    expect(wrapper.find('[role="img"]').attributes('aria-label')).toBe('12 Fotos hochgeladen')
    expect(buttonLabels(wrapper)).toEqual(['Foto aufnehmen', 'Aus Galerie'])
    expect(wrapper.find('.col-span-3').exists()).toBe(true)
    expect(heading(wrapper)).toBe('Fotos (12)')

    // The first photo moves the buttons into a row of their own, without a reload.
    await wrapper.setProps({ pending: [{ photo: photo('a'), removable: true }] })
    expect(wrapper.find('.col-span-3').exists()).toBe(false)
    expect(wrapper.find('.col-span-4').exists()).toBe(true)
    expect(heading(wrapper)).toBe('Fotos (13)')
  })

  it('with previews shows stack and previews in the grid and the buttons in their own row', () => {
    const wrapper = mountSection({
      uploadedCount: 12,
      pending: [
        { photo: photo('a'), removable: true },
        { photo: photo('b'), removable: false },
      ],
    })
    expect(wrapper.find('[role="img"]').text()).toBe('12')
    expect(wrapper.findAll('img')).toHaveLength(2)
    // Only a photo whose event is still queued can be removed.
    expect(wrapper.findAll('button[aria-label="Foto entfernen"]')).toHaveLength(1)
    expect(buttonLabels(wrapper)).toEqual(['Foto aufnehmen', 'Aus Galerie'])
    expect(wrapper.find('.col-span-3').exists()).toBe(false)
    expect(wrapper.find('.col-span-4').exists()).toBe(true)
    expect(heading(wrapper)).toBe('Fotos (14)')
  })

  it('counts previews without a stack, too', () => {
    const wrapper = mountSection({ pending: [{ photo: photo('a'), removable: true }] })
    expect(wrapper.find('[role="img"]').exists()).toBe(false)
    expect(heading(wrapper)).toBe('Fotos (1)')
  })

  it('on a split stem shows stack and previews only, no buttons and no empty row', () => {
    const wrapper = mountSection({ uploadedCount: 3, canCapture: false })
    expect(wrapper.find('[role="img"]').text()).toBe('3')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(heading(wrapper)).toBe('Fotos (3)')
    expect(mountSection({ canCapture: false }).find('.grid').exists()).toBe(false)
  })

  it('asks for the system camera, or for any number of photos from the library', async () => {
    const wrapper = mountSection()
    const [camera, gallery] = wrapper.findAll('input')
    expect(camera!.attributes()).toMatchObject({ accept: 'image/*', capture: 'environment' })
    expect(camera!.attributes('multiple')).toBeUndefined()
    expect(gallery!.attributes('accept')).toBe('image/*')
    expect(gallery!.attributes('capture')).toBeUndefined()
    expect(gallery!.attributes('multiple')).toBeDefined()

    const files = [
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['y'], 'b.jpg', { type: 'image/jpeg' }),
    ]
    Object.defineProperty(gallery!.element, 'files', { value: files, configurable: true })
    await gallery!.trigger('change')
    expect(wrapper.emitted('add')).toEqual([[files, 'gallery']])
  })

  it('cannot be tapped again while photos are processed', () => {
    const wrapper = mountSection({ busy: true })
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    for (const props of [
      { uploadedCount: 1 },
      { pending: [{ photo: photo('a'), removable: true }] },
    ]) {
      const buttons = mountSection({ busy: true, ...props }).findAll('button:not([aria-label])')
      expect(buttons).toHaveLength(2)
      expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    }
  })

  describe('a change after the screen was left', () => {
    afterEach(() => vi.restoreAllMocks())

    it('neither throws nor reports photos to the draft, but leaves a diagnostics warning', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const crashed = vi.fn()
      window.addEventListener('error', crashed)

      const wrapper = mountSection()
      const gallery = wrapper.findAll('input')[1]!.element
      await wrapper.findAll('button')[1]!.trigger('click')
      wrapper.unmount()

      // Vue keeps the listener on the detached input; iOS may answer this late.
      const files = [
        new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
        new File(['y'], 'b.jpg', { type: 'image/jpeg' }),
      ]
      Object.defineProperty(gallery, 'files', { value: files, configurable: true })
      gallery.dispatchEvent(new Event('change'))
      window.removeEventListener('error', crashed)

      expect(crashed).not.toHaveBeenCalled()
      expect(logged).not.toHaveBeenCalled()
      expect(wrapper.emitted('add')).toBeUndefined()
      await vi.waitFor(async () => expect(await loadDiagnostics()).toHaveLength(1))
      const [entry] = await loadDiagnostics()
      expect(entry).toMatchObject({
        level: 'warning',
        kind: 'photo',
        context: { source: 'gallery', files: 2 },
      })
      expect(entry!.context.ms_since_open).toBeGreaterThanOrEqual(0)
    })
  })
})
