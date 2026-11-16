import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { formatRecorded } from '@/detail'
import { fakeApi } from './fakeApi'
import { snapshotFixture } from './fakeSnapshot'
import { chipTexts, filterButton, popup, pressEscape, stubBrowser } from './popup'

// formatRecorded is called for the cells of dates and numbers: counting its calls counts the cells that are worked out
vi.mock('@/detail', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/detail')>()
  return { ...original, formatRecorded: vi.fn(original.formatRecorded) }
})

const CODE = 'K7QM-4XHT-9RDP'

async function open(path = '/stems', configure?: (api: ReturnType<typeof fakeApi>) => void) {
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
// "Filter zurücksetzen" is in the results bar, and only there while a filter is set; undefined otherwise
const resetButton = (wrapper: Wrapper) =>
  wrapper.findAll('button').find((button) => button.text() === 'Filter zurücksetzen')!
const resetButtons = (wrapper: Wrapper) =>
  wrapper.findAll('button').filter((button) => button.text() === 'Filter zurücksetzen')

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-09T12:00:00Z') })
  user.value = null
  stubBrowser()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('stem list', () => {
  it('shows the title, the sentence, the number of stems and a column per attribute of stems', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Rundholz')
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
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Rundholz')
  })

  it('writes a row: tag as link, values, "–" for what is not recorded, beams and last change', async () => {
    const { wrapper } = await open()

    expect(rowTags(wrapper)).toEqual(['00007', '00104', '01500', 'ohne Kennung'])
    const stem = wrapper.findAll('tbody tr')[1]
    expect(stem.get('a').attributes('href')).toBe('/stems/104')
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
      '31.10. Aaron Bauer',
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
    expect(header(wrapper, 'Holzfeuchte').find('svg.lucide-arrow-up-narrow-wide').exists()).toBe(
      true,
    )

    await header(wrapper, 'Holzfeuchte').get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.dir).toBe('desc')
    // not recorded stays last when descending
    expect(rowTags(wrapper)).toEqual(['00104', '01500', '00007', 'ohne Kennung'])
    expect(header(wrapper, 'Holzfeuchte').attributes('aria-sort')).toBe('descending')
    expect(header(wrapper, 'Holzfeuchte').find('svg.lucide-arrow-down-wide-narrow').exists()).toBe(
      true,
    )
    // every column has an icon: the sorted one the bar icon, all others the faint double arrow
    expect(wrapper.findAll('thead svg')).toHaveLength(wrapper.findAll('thead th').length)
    expect(wrapper.findAll('thead svg.lucide-chevrons-up-down')).toHaveLength(
      wrapper.findAll('thead th').length - 1,
    )
  })

  it('takes sort and filter from a link and ignores an unknown column', async () => {
    const { wrapper } = await open('/stems?sort=beams&dir=desc&tags=1-200')
    expect(rowTags(wrapper)).toEqual(['00104', '00007'])
    expect(header(wrapper, 'Balken').attributes('aria-sort')).toBe('descending')
    expect(field(wrapper).element.value).toBe('1-200')

    const { wrapper: other } = await open('/stems?sort=gibtsnicht')
    expect(header(other, 'Stamm').attributes('aria-sort')).toBe('ascending')
  })

  it('filters by tag, counts "von" all and resets', async () => {
    const { wrapper, router } = await open()
    expect(resetButton(wrapper)).toBeUndefined()

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
    const { wrapper, router } = await open('/stems?sort=beams&tags=104')
    await resetButton(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'Balken' })
  })

  it('shows "Waldesruh" for an empty result, with the button of the bar to reset', async () => {
    const { wrapper, router } = await open('/stems?tags=300-400')

    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(wrapper.text()).toContain('Keine Ergebnisse weit und breit gefunden.')
    expect(wrapper.find('table').exists()).toBe(false)
    // the bar above it has the button
    await resetButton(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('shows "Waldesruh" for a filter it cannot read', async () => {
    const { wrapper } = await open('/stems?tags=abc')
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(wrapper.text()).toContain('Keine Ergebnisse weit und breit gefunden.')
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
    await router.push('/stems')
    expect(wrapper.get('[role="status"]').text()).toContain('Stämme werden zurechtgesägt')
    await flushPromises()
    expect(api.calls).toContain('GET /api/snapshot')
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('shows an error with "Erneut versuchen"', async () => {
    const { wrapper, api } = await open('/stems', (api) => api.failSnapshot())
    expect(wrapper.get('[role="alert"]').text()).toContain('Hier ist grad der Wurm drin')

    api.failSnapshot(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('opens the detail view, and the way back brings the list as it was', async () => {
    const { wrapper, router } = await open('/stems?sort=beams&dir=desc')
    await wrapper.get('tbody a').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('stem')
    expect(router.currentRoute.value.params.tag).toBe('104')

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('stems'))
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

describe('filter bar and chips', () => {
  const attributeId = (name: string) => snapshotFixture.attributes.find((a) => a.name === name)!.id
  const openPopup = async (id: string) => {
    if (popup()) {
      pressEscape()
      await flushPromises()
    }
    filterButton(id).click()
    await flushPromises()
  }
  /** The checkbox or radio with this label in the open pop-up. */
  const control = (label: string) =>
    [...popup()!.querySelectorAll('label')]
      .find((candidate) => candidate.textContent!.trim() === label)!
      .querySelector('input')!
  const tick = async (label: string) => {
    control(label).click()
    await flushPromises()
  }
  const chip = (id: string) => document.querySelector<HTMLElement>(`[data-chip="${id}"]`)!
  const cross = (name: string) =>
    document.querySelector<HTMLElement>(`button[aria-label="Filter ${name} entfernen"]`)!
  const badge = (id: string) => filterButton(id).querySelector('span')?.textContent

  it('puts a button behind the field "Kennung" for every column but "Stamm", in column order', async () => {
    const { wrapper } = await open()
    const bar = wrapper.get('form')
    expect(
      bar
        .findAll('label, button')
        .map((element) => squeezed(element.text()))
        .filter(Boolean),
    ).toEqual([
      'Kennung',
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
    expect(filterButton(attributeId('Holzart')).getAttribute('aria-expanded')).toBe('false')
    // the bar does not stick: the bar of the hits and the head do
    expect(bar.element.closest('.sticky.top-0')).toBeNull()
  })

  it('filters at once by ticking: the URL, the table, the badge, the chip and the count follow', async () => {
    const { wrapper, router } = await open()
    const id = attributeId('Holzart')
    expect(chipTexts()).toEqual([])

    await openPopup(id)
    expect(popup()!.getAttribute('aria-label')).toBe('Holzart')
    await tick('Traubeneiche')
    expect(router.currentRoute.value.query).toEqual({ Holzart: 'Traubeneiche' })
    expect(rowTags(wrapper)).toEqual(['01500'])
    expect(chipTexts()).toEqual(['Holzart: Traubeneiche'])
    expect(badge(id)).toBe('1')
    expect(filterButton(id).className).toContain('border-ink')
    expect(wrapper.get('main p.text-lg').text()).toBe('1 von 4 Stämmen')

    // "Nicht erfasst" apart under a line; any of the ticks
    await tick('Nicht erfasst')
    expect(rowTags(wrapper)).toEqual(['00007', '01500', 'ohne Kennung'])
    expect(chipTexts()).toEqual(['Holzart: Traubeneiche, Nicht erfasst'])
    expect(badge(id)).toBe('2')

    await tick('Stieleiche')
    expect(chipTexts()).toEqual(['Holzart: 3 ausgewählt'])
    expect(badge(id)).toBe('3')
  })

  it('takes a range of a number with the unit and puts it into the chip; the filters work together with "und" and the Kennung', async () => {
    const { wrapper, router } = await open('/stems?tags=1-1999')
    const id = attributeId('Holzfeuchte')
    const unit = snapshotFixture.attributes.find((a) => a.name === 'Holzfeuchte')!.unit!
    await openPopup(id)
    expect(popup()!.textContent).toContain(unit)
    const [from, to] = [
      ...popup()!.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]'),
    ]
    // leaving a field applies at once (typing alone waits 500 ms, as in the field "Kennung")
    for (const [field, value] of [
      [from, '35'],
      [to, '45'],
    ] as const) {
      field.value = value
      field.dispatchEvent(new Event('input'))
      field.dispatchEvent(new Event('change'))
      await flushPromises()
    }
    expect(router.currentRoute.value.query.Holzfeuchte).toBe('35~45')
    expect(chipTexts()).toEqual(['Kennung: 1-1999', `Holzfeuchte: 35–45 ${unit}`])
    expect(rowTags(wrapper)).toEqual(['00104'])
    // no badge on a range
    expect(badge(id)).toBeUndefined()
  })

  it('restores buttons, badges and chips from a link', async () => {
    const id = attributeId('Fotos')
    await open(`/stems?tags=1-200&f.${id}=has`)
    expect(chipTexts()).toEqual(['Kennung: 1-200', 'Fotos: mit Fotos'])
    expect(filterButton(id).className).toContain('font-bold')
    expect(filterButton(attributeId('Notiz')).className).not.toContain('font-bold')
  })

  it('removes only one filter with the cross of its chip and puts the focus on the next chip, without one on the button', async () => {
    const id = attributeId('Fotos')
    const { router } = await open(`/stems?sort=beams&tags=1-200&f.${id}=has`)
    cross('Kennung').click()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'Balken', Fotos: 'has' })
    expect(document.activeElement).toBe(chip(id))

    cross('Fotos').click()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'Balken' })
    expect(chipTexts()).toEqual([])
    expect(document.activeElement).toBe(filterButton(id))
  })

  it('opens the pop-up of the filter from its chip and scrolls to the button; Escape brings the focus back', async () => {
    const id = attributeId('Fotos')
    const { wrapper } = await open(`/stems?tags=1-200&f.${id}=has`)
    chip(id).click()
    await flushPromises()
    expect(popup()!.getAttribute('aria-label')).toBe('Fotos')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(control('Mit Fotos').checked).toBe(true)

    pressEscape()
    await flushPromises()
    expect(popup()).toBeNull()
    expect(document.activeElement).toBe(filterButton(id))

    chip('tags').click()
    expect(document.activeElement).toBe(field(wrapper).element)
  })

  it('resets the filters and the "Kennung" but not the sort, and sets the focus into the field', async () => {
    const id = attributeId('Fotos')
    const { wrapper, router } = await open(`/stems?sort=beams&tags=1-200&f.${id}=has`)
    await resetButton(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sort: 'Balken' })
    expect(chipTexts()).toEqual([])
    expect(rowTags(wrapper)).toHaveLength(4)
    expect(document.activeElement).toBe(field(wrapper).element)
  })

  it('sets the focus into the field without scrolling the page up to it', async () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus')
    const { wrapper } = await open('/stems?tags=1-200')
    await resetButton(wrapper).trigger('click')
    await flushPromises()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    focus.mockRestore()
  })

  it('shows "Waldesruh" without a chip for a filter it cannot read', async () => {
    const id = attributeId('Fotos')
    const { wrapper } = await open(`/stems?f.${id}=maybe`)
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(chipTexts()).toEqual([])
    // the one button is the one of the bar
    expect(resetButtons(wrapper)).toHaveLength(1)
  })

  it('ignores a filter of a column that does not exist', async () => {
    const { wrapper } = await open('/stems?f.gibtsnicht=has&f.tag=1')
    expect(rowTags(wrapper)).toHaveLength(4)
    expect(chipTexts()).toEqual([])
  })

  it('goes back through the filters step by step with the back button', async () => {
    const { wrapper, router } = await open()
    const id = attributeId('Holzart')
    await openPopup(id)
    await tick('Traubeneiche')
    await tick('Nicht erfasst')
    expect(rowTags(wrapper)).toHaveLength(3)
    router.back()
    await flushPromises()
    expect(rowTags(wrapper)).toEqual(['01500'])
    router.back()
    await flushPromises()
    expect(rowTags(wrapper)).toHaveLength(4)
  })

  it('stays above "Waldesruh" with "0 von N Stämmen" and the chips; removing a chip brings the table back', async () => {
    const id = attributeId('Fotos')
    const { wrapper, router } = await open(`/stems?tags=300-400&f.${id}=has`)
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    const bar = wrapper.get('main p.text-lg')
    expect(bar.text()).toBe('0 von 4 Stämmen')
    expect(chipTexts()).toEqual(['Kennung: 300-400', 'Fotos: mit Fotos'])
    // before the card, and without the arrows (there is no table)
    expect(
      bar.element.compareDocumentPosition(wrapper.get('[role=status]').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(wrapper.find('button[aria-label^="Tabelle nach"]').exists()).toBe(false)

    cross('Kennung').click()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ Fotos: 'has' })
    expect(rowTags(wrapper)).toEqual(['00104'])
    expect(wrapper.get('main p.text-lg').text()).toBe('1 von 4 Stämmen')
  })

  it('has the chip of an unreadable Kennung', async () => {
    const { wrapper } = await open('/stems?tags=abc')
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(chipTexts()).toEqual(['Kennung: abc'])
    expect(wrapper.get('main p.text-lg').text()).toBe('0 von 4 Stämmen')
  })

  it('has the bar but no chip for an unreadable column filter', async () => {
    const { wrapper } = await open(`/stems?f.${attributeId('Fotos')}=maybe`)
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(chipTexts()).toEqual([])
    expect(wrapper.get('main p.text-lg').text()).toBe('0 von 4 Stämmen')
  })

  it('takes a beam tag in the Kennung: it shows the stem that has such a beam', async () => {
    const { wrapper } = await open('/stems?tags=104-b')
    expect(rowTags(wrapper)).toEqual(['00104'])
    expect(chipTexts()).toEqual(['Kennung: 104-b'])
    expect(field(wrapper).attributes('placeholder')).toBe('z. B. 104, 100-120 oder 104-A')
  })

  it('shows "Waldesruh" for a beam tag no stem has', async () => {
    const { wrapper } = await open('/stems?tags=104-D')
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
  })

  it('mixes numbers and beam tags', async () => {
    const { wrapper } = await open('/stems?tags=7,104A')
    expect(rowTags(wrapper)).toEqual(['00007', '00104'])
  })

  it('has no "Nicht erfasst" for "Geändert", and an old link with it is an unreadable filter', async () => {
    const { wrapper } = await open('/stems?f.changed=none')
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(chipTexts()).toEqual([])
    await openPopup('changed')
    expect([...popup()!.querySelectorAll('label')].map((l) => l.textContent!.trim())).toEqual([
      'Von',
      'Bis',
    ])
  })

  it('has "Filter zurücksetzen" only with a filter, once, at the right of the bar left of the arrows', async () => {
    const { wrapper } = await open()
    expect(resetButton(wrapper)).toBeUndefined()
    expect(wrapper.get('form').text()).not.toContain('Filter zurücksetzen')

    const { wrapper: filtered } = await open('/stems?tags=300-400')
    // "Waldesruh" has no button of its own any more
    expect(resetButtons(filtered)).toHaveLength(1)
    expect(filtered.get('[role=status]').find('button').exists()).toBe(false)
    expect(filtered.get('form').text()).not.toContain('Filter zurücksetzen')
    const actions = resetButton(filtered).element.parentElement!
    expect(actions.className).toContain('justify-self-end')
  })
})

describe('Schnittholz list', () => {
  it('shows the beams with the beam attributes, "Balken" first, no count of beams and no column of the stem', async () => {
    const { wrapper } = await open('/beams')

    expect(wrapper.get('h1').text()).toBe('Schnittholz')
    expect(wrapper.get('main p.text-lg').text()).toBe('3 Balken')
    expect(wrapper.findAll('thead th').map((th) => squeezed(th.text()))).toEqual([
      'Balken',
      'Lieferdatum',
      'Sortierklasse',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
      'Geändert',
    ])
    expect(header(wrapper, 'Balken').attributes('aria-sort')).toBe('ascending')
    expect(rowTags(wrapper)).toEqual(['00104-A', '00104-B', '00104-C'])
    expect(wrapper.get('nav a[aria-current="page"]').text()).toBe('Schnittholz')
    // a click on the tag opens the detail view of the beam
    expect(wrapper.get('tbody a').attributes('href')).toBe('/beams/104-A')
  })

  it('filters by tag and keeps the state in its own URL, apart from Rundholz', async () => {
    const { wrapper, router } = await open('/beams?tags=104-b&sort=Notiz')

    expect(rowTags(wrapper)).toEqual(['00104-B'])
    expect(wrapper.get('main p.text-lg').text()).toBe('1 von 3 Balken')
    expect(field(wrapper).element.value).toBe('104-b')

    await router.push('/stems')
    await flushPromises()
    expect(rowTags(wrapper)).toEqual(['00007', '00104', '01500', 'ohne Kennung'])
    expect(field(wrapper).element.value).toBe('')
  })

  it('has the filters of the list for its columns', async () => {
    const { wrapper } = await open('/beams')

    const buttons = wrapper.findAll('form button').map((button) => squeezed(button.text()))
    expect(buttons).toEqual(
      expect.arrayContaining(['Lieferdatum', 'Sortierklasse', 'Holzfeuchte', 'Notiz', 'Fotos']),
    )
    expect(buttons).not.toContain('Holzart')
  })

  it('links every row to the detail route of its kind, a stem sawn whole too', async () => {
    const stems = await open('/stems')
    expect(stems.wrapper.findAll('tbody a').map((link) => link.attributes('href'))).toEqual([
      '/stems/7',
      '/stems/104',
      '/stems/1500',
    ])

    const whole = {
      ...snapshotFixture.timber_items.find((item) => item.tag_number === '7')!,
      id: 'whole',
      tag_number: '200',
      values: {
        [snapshotFixture.attributes.find((attribute) => attribute.key === 'sawn')!.id]: [
          {
            value: true,
            recorded_at: '2026-10-21T08:00:00.000Z',
            user_id: snapshotFixture.users[0].id,
            event_id: 'e-whole',
          },
        ],
      },
    }
    const { wrapper, router } = await open('/beams', (api) =>
      api.setSnapshot({
        ...snapshotFixture,
        timber_items: [...snapshotFixture.timber_items, whole],
      }),
    )
    expect(wrapper.findAll('tbody a').map((link) => link.attributes('href'))).toEqual([
      '/beams/104-A',
      '/beams/104-B',
      '/beams/104-C',
      '/stems/200',
    ])

    await wrapper.findAll('tbody a')[3].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/stems/200')
    expect(router.currentRoute.value.name).toBe('stem')
  })

  it('shows the message for no beams', async () => {
    const { wrapper } = await open('/beams?tags=300-400')

    expect(wrapper.get('[role="status"]').text()).toContain('Waldesruh')
    expect(wrapper.get('main p.text-lg').text()).toBe('0 von 3 Balken')
  })
})
