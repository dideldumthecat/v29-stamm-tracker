import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type DOMWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { Blob as NodeBlob } from 'node:buffer'
import SyncView from '@/views/SyncView.vue'
import { useTimberItemStore } from '@/stores/timberItems'

const mounted: { unmount: () => void }[] = []

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'start', component: {} },
      { path: '/timber-item/:tagNumber', name: 'timber-item', component: {} },
    ],
  })
  await router.push('/')
  const wrapper = mount(SyncView, { global: { plugins: [router] }, attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}

// The sheet teleports to the body.
const dialog = () => document.body.querySelector('[role="dialog"]')!
const dialogButtons = () =>
  [...dialog().querySelectorAll('button')].map((b) => b.textContent?.trim())

// Headings of a section: the stem first, then its beams, each with link target and "neu" badge.
const headings = (section: DOMWrapper<Element>) =>
  section
    .findAll('strong')
    .map((heading) =>
      [...heading.element.children]
        .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
        .join(' '),
    )
const attributeId = (name: string) =>
  useTimberItemStore().attributes.find((attribute) => attribute.name === name)!.id

describe('SyncView: sections by stem', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => mounted.splice(0).forEach((wrapper) => wrapper.unmount()))

  it('gives a stem with entries of its beams only its own heading', async () => {
    const store = useTimberItemStore()
    store.recordAttribute(store.findByTag('789-A')!.id, attributeId('Sortierklasse'), 'x')
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(1)
    expect(headings(sections[0]!)).toEqual(['Stamm 00789', 'Balken 00789-A'])
    expect(sections[0]!.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/timber-item/789',
      '/timber-item/789-A',
    ])
    expect(sections[0]!.text()).toContain('Sortierklasse')
  })

  it('shows a removed beam under its stem, without a link', async () => {
    const store = useTimberItemStore()
    store.removeTimberItem(store.findByTag('789-B')!.id)
    const wrapper = await mountView()

    const section = wrapper.find('section')
    expect(headings(section)).toEqual(['Stamm 00789', 'Balken 00789-B'])
    expect(section.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/timber-item/789',
    ])
    expect(section.text()).toContain('Balken 00789-B entfernen')
  })

  it('marks a new beam of an existing stem as new, not the stem', async () => {
    const store = useTimberItemStore()
    store.addBeam(store.findByTag('789')!.id)
    const wrapper = await mountView()

    expect(headings(wrapper.find('section'))).toEqual(['Stamm 00789', 'Balken 00789-C neu'])
  })

  it('puts a new stem and its new beams into one section, beams by tag', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(42)
    store.addBeam(stem.id)
    store.addBeam(stem.id)
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(1)
    expect(headings(sections[0]!)).toEqual([
      'Stamm 00042 neu',
      'Balken 00042-A neu',
      'Balken 00042-B neu',
    ])
  })

  it('lists the photo files left of a beam under that beam', async () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-A')!
    const photoAttribute = store.attributes.find((attribute) => attribute.type === 'photo')!.id
    store.addPhoto(
      beam.id,
      photoAttribute,
      new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob,
    )
    const photoId = store.photos[0]!.id
    // The event is on the server already, only the file is left.
    const queued = store.events.splice(0)
    const wrapper = await mountView()

    const section = wrapper.find('section')
    expect(headings(section)).toEqual(['Stamm 00789', 'Balken 00789-A'])
    expect(section.text()).toMatch(/Balken 00789-A[\s\S]*Foto \(/)
    store.events.push(...queued)
    store.removePhoto(photoId)
  })
})

describe('SyncView: discarding the removal of a synced beam', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => mounted.splice(0).forEach((wrapper) => wrapper.unmount()))

  async function openRemovalDialog(letterTaken: boolean) {
    const store = useTimberItemStore()
    store.removeTimberItem(store.findByTag('789-B')!.id)
    if (letterTaken) {
      store.addBeam(store.findByTag('789')!.id)
    }
    const wrapper = await mountView()
    await wrapper.find('button[aria-label="Eintrag verwerfen"]').trigger('click')
  }

  it('offers to discard and names the letter that is occupied again', async () => {
    await openRemovalDialog(false)
    expect(dialog().textContent).toContain('Entfernen von Balken 00789-B verwerfen?')
    expect(dialog().textContent).toContain(
      'Der Balken ist danach wieder da. Der Buchstabe B ist dann wieder belegt.',
    )
    expect(dialogButtons()).toEqual(['Verwerfen', 'Abbrechen'])
  })

  it('only informs when a new beam took the letter', async () => {
    await openRemovalDialog(true)
    expect(dialog().textContent).toContain('Entfernen von Balken 00789-B verwerfen?')
    expect(dialog().textContent).toContain(
      'Der Buchstabe B ist inzwischen an einen neuen Balken vergeben. Um 00789-B zurückzuholen, erst den neuen Balken 00789-B entfernen.',
    )
    expect(dialogButtons()).toEqual(['Verstanden'])
  })
})
