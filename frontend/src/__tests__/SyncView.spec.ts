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

// Heading of a section with "neu" badge.
const heading = (section: DOMWrapper<Element>) =>
  [...section.find('strong').element.children]
    .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
    .join(' ')
const rowTexts = (section: DOMWrapper<Element>) =>
  section.findAll('b').map((row) => row.element.textContent?.replace(/\s+/g, ' ').trim())
const attributeId = (name: string) =>
  useTimberItemStore().attributes.find((attribute) => attribute.name === name)!.id

describe('SyncView: sections by item', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => mounted.splice(0).forEach((wrapper) => wrapper.unmount()))

  it('gives a new stem its values and the creation of its new beams in one section', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(42)
    store.recordAttribute(stem.id, attributeId('Sortierklasse'), 'x')
    store.addBeam(stem.id)
    store.addBeam(stem.id)
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(1)
    expect(heading(sections[0]!)).toBe('Stamm 00042 neu')
    expect(sections[0]!.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/timber-item/42',
    ])
    expect(rowTexts(sections[0]!)).toEqual([
      'Stamm angelegt',
      expect.stringContaining('Sortierklasse'),
      'Balken angelegt: 00042-A',
      'Balken angelegt: 00042-B',
    ])
  })

  it('shows a new beam of a locked stem as a row of the stem, without a badge', async () => {
    const store = useTimberItemStore()
    store.addBeam(store.findByTag('789')!.id)
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(1)
    expect(heading(sections[0]!)).toBe('Stamm 00789')
    expect(rowTexts(sections[0]!)).toEqual(['Balken angelegt: 00789-C'])
  })

  it('gives a new beam with values of its own a section of its own', async () => {
    const store = useTimberItemStore()
    const beam = store.addBeam(store.findByTag('789')!.id)
    store.recordAttribute(beam.id, attributeId('Sortierklasse'), 'x')
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections.map(heading)).toEqual(['Balken 00789-C', 'Stamm 00789'])
    expect(rowTexts(sections[1]!)).toEqual(['Balken angelegt: 00789-C'])
    expect(rowTexts(sections[0]!)).toEqual([expect.stringContaining('Sortierklasse')])
    expect(sections[0]!.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/timber-item/789-C',
    ])
  })

  it('shows a removed beam as a row of its stem', async () => {
    const store = useTimberItemStore()
    store.removeTimberItem(store.findByTag('789-B')!.id)
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(1)
    expect(heading(sections[0]!)).toBe('Stamm 00789')
    expect(rowTexts(sections[0]!)).toEqual(['Balken 00789-B entfernen'])
  })

  it('heads the open values of a removed beam without a link', async () => {
    const store = useTimberItemStore()
    const beam = store.findByTag('789-B')!
    store.recordAttribute(beam.id, attributeId('Sortierklasse'), 'x')
    const late = store.events.splice(0)
    store.removeTimberItem(beam.id)
    // Removing drops what is pending; a value that reached the queue after the removal is faked this way.
    store.events.push(...late)
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    // The late value is newer than the removal, so the beam comes first.
    expect(sections.map(heading)).toEqual(['Balken 00789-B', 'Stamm 00789'])
    expect(sections[0]!.findAll('a')).toHaveLength(0)
    expect(sections[1]!.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/timber-item/789',
    ])
    expect(rowTexts(sections[1]!)).toEqual(['Balken 00789-B entfernen'])
  })

  it('puts the most recently changed section on top, rows within it stay in recording order', async () => {
    const store = useTimberItemStore()
    const stem = store.createTimberItem(42)
    store.recordAttribute(stem.id, attributeId('Sortierklasse'), 'x')
    store.recordAttribute(store.findByTag('123')!.id, attributeId('Sortierklasse'), 'y')
    const time = (event: { type: string; timber_item_id: string }) =>
      event.timber_item_id !== stem.id
        ? '2026-11-02T08:03:00.000Z'
        : event.type === 'attribute_recorded'
          ? '2026-11-02T08:05:00.000Z'
          : '2026-11-02T08:00:00.000Z'
    store.events.forEach((event) => (event.recorded_at = time(event)))
    const wrapper = await mountView()

    const sections = wrapper.findAll('section')
    expect(sections.map(heading)).toEqual(['Stamm 00042 neu', 'Stamm 00123'])
    expect(rowTexts(sections[0]!)).toEqual([
      'Stamm angelegt',
      expect.stringContaining('Sortierklasse'),
    ])
  })

  it('orders sections with the same latest time by the reverse queue order', async () => {
    const store = useTimberItemStore()
    store.createTimberItem(42)
    store.createTimberItem(43)
    store.createTimberItem(44)
    store.events.forEach((event) => (event.recorded_at = '2026-11-02T08:00:00.000Z'))
    const wrapper = await mountView()

    expect(wrapper.findAll('section').map(heading)).toEqual([
      'Stamm 00044 neu',
      'Stamm 00043 neu',
      'Stamm 00042 neu',
    ])
  })

  it('counts a photo file without an event with its time of capture', async () => {
    const store = useTimberItemStore()
    store.recordAttribute(store.findByTag('123')!.id, attributeId('Sortierklasse'), 'y')
    store.events[0]!.recorded_at = '2026-11-02T08:00:00.000Z'
    const beam = store.findByTag('789-A')!
    const photoAttribute = store.attributes.find((attribute) => attribute.type === 'photo')!.id
    store.addPhoto(
      beam.id,
      photoAttribute,
      new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob,
    )
    const photo = store.photos[0]!
    photo.taken_at = '2026-11-02T09:00:00.000Z'
    // The event is on the server already, only the file is left.
    const queued = store.events.splice(1)
    const wrapper = await mountView()

    expect(wrapper.findAll('section').map(heading)).toEqual(['Balken 00789-A', 'Stamm 00123'])
    store.events.push(...queued)
    store.removePhoto(photo.id)
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
    expect(heading(section)).toBe('Balken 00789-A')
    expect(section.text()).toContain('Foto (')
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
