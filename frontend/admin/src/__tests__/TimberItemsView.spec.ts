import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { formatRecorded } from '@/detail'
import { fakeApi } from './fakeApi'

// formatRecorded is called for the cells of dates and numbers: counting its calls counts the cells that are worked out
vi.mock('@/detail', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/detail')>()
  return { ...original, formatRecorded: vi.fn(original.formatRecorded) }
})

const CODE = 'K7QM-4XHT-9RDP'

async function open(path = '/staemme', configure?: (api: ReturnType<typeof fakeApi>) => void) {
  const api = fakeApi({ [CODE]: 'admin' })
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(CODE)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  configure?.(api)
  await router.push(path)
  await flushPromises()
  return { api, router, wrapper }
}
type Wrapper = Awaited<ReturnType<typeof open>>['wrapper']

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()
const rowTags = (wrapper: Wrapper) => wrapper.findAll('tbody th').map((th) => squeezed(th.text()))
const header = (wrapper: Wrapper, label: string) =>
  wrapper.findAll('thead th').find((th) => th.text().startsWith(label))!
const field = (wrapper: Wrapper) => wrapper.get<HTMLInputElement>('#stems-tags')
const resetButton = (wrapper: Wrapper) =>
  wrapper
    .get('form')
    .findAll('button')
    .find((button) => button.text() === 'Filter zurücksetzen')!

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-09T12:00:00Z') })
  user.value = null
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('stem list', () => {
  it('shows the title, the sentence, the number of stems and a column per attribute of stems', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Stämme')
    expect(wrapper.get('h1 + p').text()).toBe('Eine Spalte je Merkmal, Reihenfolge wie in der App.')
    expect(wrapper.get('main p.text-lg').text()).toBe('4 Stämme')
    expect(wrapper.findAll('thead th').map((th) => squeezed(th.text()))).toEqual([
      'Stamm',
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Lagerplatz',
      'Gesägt',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
      'Balken',
      'Geändert',
    ])
    expect(wrapper.text()).not.toContain('Sortierklasse')
    expect(header(wrapper, 'Stamm').attributes('aria-sort')).toBe('ascending')
    expect(header(wrapper, 'Holzart').attributes('aria-sort')).toBeUndefined()
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Stämme')
  })

  it('writes a row: tag as link, values, "–" for what is not recorded, beams and last change', async () => {
    const { wrapper } = await open()

    expect(rowTags(wrapper)).toEqual(['00007', '00104', '01500', 'ohne Kennung'])
    const stem = wrapper.findAll('tbody tr')[1]
    expect(stem.get('a').attributes('href')).toBe('/staemme/104')
    expect(stem.findAll('td').map((td) => squeezed(td.text()))).toEqual([
      'Stieleiche',
      '10/2026',
      '–',
      '–',
      'ja',
      '41 %',
      'Zweite Zeile mit Umbruch(+1)',
      '2',
      '3',
      '31.10. Alexander Barina',
    ])
    // the stem without tag is no link
    expect(wrapper.findAll('tbody tr')[3].find('a').exists()).toBe(false)
  })

  it('sorts on a click, the other direction on the next, and keeps it in the URL', async () => {
    const { wrapper, router } = await open()

    await header(wrapper, 'Holzfeuchte').get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: expect.any(String) })
    expect(rowTags(wrapper)).toEqual(['01500', '00104', '00007', 'ohne Kennung'])
    expect(header(wrapper, 'Holzfeuchte').attributes('aria-sort')).toBe('ascending')
    expect(header(wrapper, 'Holzfeuchte').find('svg.lucide-arrow-up').exists()).toBe(true)

    await header(wrapper, 'Holzfeuchte').get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.dir).toBe('desc')
    // not recorded stays last when descending
    expect(rowTags(wrapper)).toEqual(['00104', '01500', '00007', 'ohne Kennung'])
    expect(header(wrapper, 'Holzfeuchte').attributes('aria-sort')).toBe('descending')
    expect(header(wrapper, 'Holzfeuchte').find('svg.lucide-arrow-down').exists()).toBe(true)
    expect(wrapper.findAll('thead svg')).toHaveLength(1)
  })

  it('takes sort and filter from a link and ignores an unknown column', async () => {
    const { wrapper } = await open('/staemme?sort=beams&dir=desc&tags=1-200')
    expect(rowTags(wrapper)).toEqual(['00104', '00007'])
    expect(header(wrapper, 'Balken').attributes('aria-sort')).toBe('descending')
    expect(field(wrapper).element.value).toBe('1-200')

    const { wrapper: other } = await open('/staemme?sort=gibtsnicht')
    expect(header(other, 'Stamm').attributes('aria-sort')).toBe('ascending')
  })

  it('filters by tag, counts "von" all and resets', async () => {
    const { wrapper, router } = await open()
    expect(resetButton(wrapper).attributes('disabled')).toBeDefined()

    await field(wrapper).setValue('100-120')
    await flushPromises()
    expect(router.currentRoute.value.query.tags).toBe('100-120')
    expect(rowTags(wrapper)).toEqual(['00104'])
    expect(wrapper.get('main p.text-lg').text()).toBe('1 von 4 Stämmen')

    await resetButton(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(field(wrapper).element.value).toBe('')
    expect(wrapper.get('main p.text-lg').text()).toBe('4 Stämme')
  })

  it('keeps the sort when the filter is reset', async () => {
    const { wrapper, router } = await open('/staemme?sort=beams&tags=104')
    await resetButton(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'beams' })
  })

  it('shows "Waldesruh" for an empty result, with the button to reset', async () => {
    const { wrapper, router } = await open('/staemme?tags=300-400')

    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(wrapper.text()).toContain('Für diese Auswahl gibt es keine Stämme.')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.get('[role="status"] button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('shows "Waldesruh" for a filter it cannot read', async () => {
    const { wrapper } = await open('/staemme?tags=abc')
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(wrapper.text()).toContain(
      'Die Filter verstehen wir nicht. Kennung zum Beispiel 104 oder 100-120.',
    )
  })

  it('shows the saw blade while loading', async () => {
    const api = fakeApi({ [CODE]: 'admin' })
    const router = createAdminRouter(createMemoryHistory())
    await router.push('/login')
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('input').setValue(CODE)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await router.push('/staemme')
    expect(wrapper.get('[role="status"]').text()).toContain('Stämme werden zurechtgesägt')
    await flushPromises()
    expect(api.calls).toContain('GET /api/snapshot')
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('shows an error with "Erneut versuchen"', async () => {
    const { wrapper, api } = await open('/staemme', (api) => api.failSnapshot())
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Die Stämme konnten nicht geladen werden.',
    )

    api.failSnapshot(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('opens the detail view, and the way back brings the list as it was', async () => {
    const { wrapper, router } = await open('/staemme?sort=beams&dir=desc')
    await wrapper.get('tbody a').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timber-item')
    expect(router.currentRoute.value.params.tag).toBe('104')

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('timber-items'))
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'beams', dir: 'desc' })
    expect(rowTags(wrapper)[0]).toBe('00104')
  })
})

describe('cell values', () => {
  it('are worked out once per snapshot, not again for the arrows, a sort or a filter', async () => {
    const { wrapper } = await open()
    const worked = vi.mocked(formatRecorded).mock.calls.length
    expect(worked).toBeGreaterThan(0)

    // the arrows appear and change state: the view draws again
    const page = document.documentElement
    Object.defineProperty(page, 'clientWidth', { get: () => 500, configurable: true })
    Object.defineProperty(page, 'scrollWidth', { get: () => 900, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(wrapper.find('button[aria-label="Tabelle nach rechts scrollen"]').exists()).toBe(true)

    await header(wrapper, 'Holzfeuchte').get('button').trigger('click')
    await flushPromises()
    await field(wrapper).setValue('100-120')
    await flushPromises()
    expect(rowTags(wrapper)).toEqual(['00104'])
    expect(vi.mocked(formatRecorded).mock.calls.length).toBe(worked)

    Object.defineProperty(page, 'clientWidth', { get: () => 0, configurable: true })
    Object.defineProperty(page, 'scrollWidth', { get: () => 0, configurable: true })
  })
})

describe('arrows for scrolling the page sideways', () => {
  // jsdom lays nothing out: the sizes of the page are set by hand, then it is told that it scrolled
  const page = document.documentElement
  async function layout(sizes: { clientWidth: number; scrollWidth: number; scrollX: number }) {
    for (const name of ['clientWidth', 'scrollWidth'] as const) {
      Object.defineProperty(page, name, { get: () => sizes[name], configurable: true })
    }
    Object.defineProperty(window, 'scrollX', { get: () => sizes.scrollX, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()
  }
  const arrow = (wrapper: Wrapper, direction: 'links' | 'rechts') =>
    wrapper.find<HTMLButtonElement>(`button[aria-label="Tabelle nach ${direction} scrollen"]`)
  beforeEach(() => {
    window.scrollBy = vi.fn()
  })
  afterEach(() => layout({ clientWidth: 0, scrollWidth: 0, scrollX: 0 }))

  it('shows none while the table fits, and takes no room', async () => {
    const { wrapper } = await open()
    await layout({ clientWidth: 900, scrollWidth: 900, scrollX: 0 })

    expect(arrow(wrapper, 'links').exists()).toBe(false)
    expect(arrow(wrapper, 'rechts').exists()).toBe(false)
    expect(wrapper.find('.shadow, [class*="shadow"]').exists()).toBe(false)
  })

  it('disables the arrow to the left at the start, the one to the right at the end, none in between', async () => {
    const { wrapper } = await open()
    const wide = { clientWidth: 500, scrollWidth: 900 }

    await layout({ ...wide, scrollX: 0 })
    expect(arrow(wrapper, 'links').element.disabled).toBe(true)
    expect(arrow(wrapper, 'rechts').element.disabled).toBe(false)

    await layout({ ...wide, scrollX: 120 })
    expect(arrow(wrapper, 'links').element.disabled).toBe(false)
    expect(arrow(wrapper, 'rechts').element.disabled).toBe(false)

    await layout({ ...wide, scrollX: 400 })
    expect(arrow(wrapper, 'links').element.disabled).toBe(false)
    expect(arrow(wrapper, 'rechts').element.disabled).toBe(true)
  })

  it('scrolls the page by 60 % of the window width, smoothly', async () => {
    const { wrapper } = await open()
    await layout({ clientWidth: 500, scrollWidth: 900, scrollX: 120 })

    await arrow(wrapper, 'rechts').trigger('click')
    expect(window.scrollBy).toHaveBeenLastCalledWith({ left: 300, behavior: 'smooth' })
    await arrow(wrapper, 'links').trigger('click')
    expect(window.scrollBy).toHaveBeenLastCalledWith({ left: -300, behavior: 'smooth' })
  })

  it('scrolls without animation if the system asks for less motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { wrapper } = await open()
    await layout({ clientWidth: 500, scrollWidth: 900, scrollX: 0 })

    await arrow(wrapper, 'rechts').trigger('click')
    expect(window.scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'auto' })
  })
})
