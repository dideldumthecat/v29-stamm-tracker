import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils'

import { user } from '@/auth'
import {
  attributeOf,
  buttonWith,
  dialog,
  dialogButton,
  field,
  handle,
  open,
  previewNames,
  settings,
  type Opened,
} from './attributesPage'
import { stubBrowser } from './popup'

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const names = (wrapper: VueWrapper) =>
  previewNames(wrapper).map((name) =>
    name!.replace(' (Systemmerkmal)', '').replace(' (vom Stamm geerbt)', ''),
  )
/** The order the server holds, by name. */
const stored = (api: Opened['api']) => api.attributes.attributes.map((attribute) => attribute.name)
const puts = (api: Opened['api']) =>
  api.calls.filter((call) => call === 'PUT /api/admin/attributes/order')
const press = (wrapper: VueWrapper, name: string, key: 'ArrowUp' | 'ArrowDown') =>
  handle(wrapper, name).trigger('keydown', { key })

/** jsdom has no layout: every element in a list is 100 px high, one below the other. */
function stubLayout(selector: string, height = 100) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = this.matches(selector) ? [...this.parentElement!.children].indexOf(this) : 0
    return {
      top: index * height,
      bottom: (index + 1) * height,
      height,
      left: 0,
      right: 400,
      width: 400,
      x: 0,
      y: index * height,
      toJSON() {},
    }
  })
}
/** The finger or mouse goes down on a handle (VTU cannot set `button` of an event). */
const pressDown = (handle: { element: Element }, clientY: number, button = 0) =>
  handle.element.dispatchEvent(
    new PointerEvent('pointerdown', { button, clientY, bubbles: true, cancelable: true }),
  )
const pointer = (type: string, clientY: number) =>
  window.dispatchEvent(new PointerEvent(type, { clientY, bubbles: true }))

describe('sorting the attributes with the keyboard', () => {
  it('moves one place with the arrow keys and saves the whole order at once', async () => {
    const { wrapper, api } = await open()
    const before = stored(api)

    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()

    expect(names(wrapper).slice(0, 3)).toEqual(['Fälldatum', 'Holzart', 'Lieferdatum'])
    expect(puts(api)).toHaveLength(1)
    expect(stored(api)).toEqual([before[1], before[0], ...before.slice(2)])
    expect(api.attributes.attributes.map((attribute) => attribute.sort_order)).toEqual(
      before.map((_, index) => 10 * (index + 1)),
    )
    // after a reload the new order is still there: it is the server's
    expect(JSON.stringify(api.calls)).toContain('PUT /api/admin/attributes/order')
  })

  it('keeps the focus on the handle that was moved', async () => {
    const { wrapper } = await open()
    const grip = handle(wrapper, 'Holzart').element as HTMLElement
    grip.focus()

    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Holzart verschieben')
    expect(wrapper.get('[role=status]').text()).toBe(
      'Holzart ist jetzt an Stelle 2 von 8. Reihenfolge gespeichert.',
    )
  })

  it('does nothing at the ends', async () => {
    const { wrapper, api } = await open()

    await press(wrapper, 'Holzart', 'ArrowUp')
    await press(wrapper, 'Fotos', 'ArrowDown')
    await flushPromises()

    expect(puts(api)).toHaveLength(0)
    expect(names(wrapper)[0]).toBe('Holzart')
  })

  it('moves a system attribute too', async () => {
    const { wrapper, api } = await open()

    await press(wrapper, 'Gesägt', 'ArrowUp')
    await flushPromises()

    expect(stored(api).indexOf('Gesägt')).toBeLessThan(stored(api).indexOf('Lagerplatz'))
    expect(names(wrapper)).toContain('Gesägt')
  })

  it('goes back to the old order with a message when saving fails', async () => {
    const { wrapper, api } = await open()
    const before = names(wrapper)
    api.attributes.failOrder()

    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()

    expect(names(wrapper)).toEqual(before)
    expect(wrapper.get('[role=alert]').text()).toBe(
      'Die Reihenfolge konnte nicht gespeichert werden. Sie ist wieder wie vorher.',
    )
    // the next move works and takes the message away
    api.attributes.failOrder(false)
    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(names(wrapper)[1]).toBe('Holzart')
  })

  it('has handles that are buttons with a name', async () => {
    const { wrapper } = await open()

    const grip = handle(wrapper, 'Holzart')
    expect(grip.element.tagName).toBe('BUTTON')
    expect(grip.attributes('aria-label')).toBe('Holzart verschieben')
    expect(grip.attributes('disabled')).toBeUndefined()
  })
})

describe('the order in the view "Balken"', () => {
  it('moves only among the attributes of the view, the others keep their places', async () => {
    const { wrapper, api } = await open('/attributes?view=beam')
    const before = stored(api)
    // the stem attributes that the beams inherit are in it, "Lagerplatz" (stem only, not inheritable) is not
    expect(names(wrapper)).toEqual([
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Gesägt',
      'Sortierklasse',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
    ])

    await press(wrapper, 'Sortierklasse', 'ArrowUp')
    await flushPromises()

    expect(names(wrapper)).toEqual([
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Sortierklasse',
      'Gesägt',
      'Holzfeuchte',
      'Notiz',
      'Fotos',
    ])
    const after = stored(api)
    // what is not in the view (Lagerplatz, the inactive "Entlastungsschnitt") stays at its place
    for (const name of ['Lagerplatz', 'Entlastungsschnitt']) {
      expect(after.indexOf(name)).toBe(before.indexOf(name))
    }
    expect(after.indexOf('Sortierklasse')).toBeLessThan(after.indexOf('Gesägt'))
    expect(after).toHaveLength(before.length)
    // the other view shows the same order for what it has in common
    await buttonWith(wrapper, 'Stamm')!.trigger('click')
    await flushPromises()
    const stem = names(wrapper)
    expect(stem.indexOf('Lieferdatum')).toBeGreaterThan(-1)
    expect(stem.indexOf('Lieferdatum')).toBe(
      after.filter((name) => stem.includes(name)).indexOf('Lieferdatum'),
    )
  })
})

describe('sorting the attributes by dragging', () => {
  it('shows the item following the pointer, then saves the new place after release', async () => {
    const { wrapper, api } = await open()
    stubLayout('[data-attribute]')
    const items = () => wrapper.findAll<HTMLElement>('[data-attribute]')

    pressDown(handle(wrapper, 'Holzart'), 50, 0)
    pointer('pointermove', 270)
    await flushPromises()

    // the dragged one is 220 px down; the two it passed make room by their height
    expect(items()[0].attributes('style')).toContain('translateY(220px)')
    expect(items()[1].attributes('style')).toContain('translateY(-100px)')
    expect(items()[2].attributes('style')).toContain('translateY(-100px)')
    expect(items()[3].attributes('style')).toContain('translateY(0px)')
    expect(puts(api)).toHaveLength(0)

    pointer('pointerup', 270)
    await flushPromises()

    expect(names(wrapper).slice(0, 3)).toEqual(['Fälldatum', 'Lieferdatum', 'Holzart'])
    expect(stored(api).slice(0, 3)).toEqual(['Fälldatum', 'Lieferdatum', 'Holzart'])
    expect(items()[0].attributes('style') ?? '').not.toContain('translate')
  })

  it('drags upwards too', async () => {
    const { wrapper, api } = await open()
    stubLayout('[data-attribute]')

    pressDown(handle(wrapper, 'Lagerplatz'), 350, 0)
    pointer('pointermove', 90)
    pointer('pointerup', 90)
    await flushPromises()

    expect(names(wrapper).slice(0, 3)).toEqual(['Holzart', 'Lagerplatz', 'Fälldatum'])
    expect(stored(api).slice(0, 3)).toEqual(['Holzart', 'Lagerplatz', 'Fälldatum'])
  })

  it('drops nothing when it is released where it was, or with Escape', async () => {
    const { wrapper, api } = await open()
    stubLayout('[data-attribute]')

    pressDown(handle(wrapper, 'Holzart'), 50, 0)
    pointer('pointermove', 60)
    pointer('pointerup', 60)
    await flushPromises()
    pressDown(handle(wrapper, 'Holzart'), 50, 0)
    pointer('pointermove', 350)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    pointer('pointerup', 350)
    await flushPromises()

    expect(puts(api)).toHaveLength(0)
    expect(names(wrapper)[0]).toBe('Holzart')
    expect(wrapper.get<HTMLElement>('[data-attribute]').attributes('style') ?? '').not.toContain(
      'translate',
    )
  })

  it('ignores the other buttons of the mouse', async () => {
    const { wrapper, api } = await open()
    stubLayout('[data-attribute]')

    pressDown(handle(wrapper, 'Holzart'), 50, 2)
    pointer('pointermove', 350)
    pointer('pointerup', 350)
    await flushPromises()

    expect(puts(api)).toHaveLength(0)
  })

  it('does not select the attribute', async () => {
    const { wrapper, router } = await open()
    await handle(wrapper, 'Holzart').trigger('click')
    expect(router.currentRoute.value.query.attribute).toBeUndefined()
    expect(field(wrapper, 'Holzart').attributes('aria-current')).toBeUndefined()
  })
})

describe('sorting the options', () => {
  async function lagerplatz() {
    const opened = await open()
    await field(opened.wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    return opened
  }
  const labels = (wrapper: VueWrapper) =>
    settings(wrapper)
      .findAll<HTMLInputElement>('input[aria-label^="Option"]')
      .map((input) => input.element.value)
  const optionHandle = (wrapper: VueWrapper, label: string) =>
    settings(wrapper)
      .findAll('button[data-handle]')
      .find((button) => button.attributes('aria-label') === `${label} verschieben`)!

  it('are moved with the arrow keys as a change of the form, saved with "Speichern"', async () => {
    const { wrapper, api } = await lagerplatz()
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    await optionHandle(wrapper, 'Polter Süd').trigger('keydown', { key: 'ArrowUp' })

    expect(labels(wrapper)).toEqual(['Polter Süd', 'Polter Nord', 'Waldweg Ost'])
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()
    expect(api.calls.filter((call) => call.startsWith('PATCH'))).toHaveLength(0)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Polter Süd verschieben')

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    expect(attributeOf(api, 'Lagerplatz').options.map((option) => option.label)).toEqual([
      'Polter Süd',
      'Polter Nord',
      'Waldweg Ost',
    ])
    expect(labels(wrapper)).toEqual(['Polter Süd', 'Polter Nord', 'Waldweg Ost'])
  })

  it('stay where they are at the ends of the list', async () => {
    const { wrapper } = await lagerplatz()

    await optionHandle(wrapper, 'Polter Nord').trigger('keydown', { key: 'ArrowUp' })
    await optionHandle(wrapper, 'Waldweg Ost').trigger('keydown', { key: 'ArrowDown' })

    expect(labels(wrapper)).toEqual(['Polter Nord', 'Polter Süd', 'Waldweg Ost'])
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
  })

  it('are dragged, and "Verwerfen" takes the order back', async () => {
    const { wrapper } = await lagerplatz()
    stubLayout('[data-row]', 60)

    pressDown(optionHandle(wrapper, 'Polter Nord'), 30, 0)
    pointer('pointermove', 100)
    pointer('pointerup', 100)
    await flushPromises()

    expect(labels(wrapper)).toEqual(['Polter Süd', 'Polter Nord', 'Waldweg Ost'])

    await buttonWith(wrapper, 'Verwerfen')!.trigger('click')
    expect(labels(wrapper)).toEqual(['Polter Nord', 'Polter Süd', 'Waldweg Ost'])
  })

  it('count as an unsaved change: switching asks', async () => {
    const { wrapper } = await lagerplatz()
    await optionHandle(wrapper, 'Polter Süd').trigger('keydown', { key: 'ArrowUp' })

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(dialog()).not.toBeNull()
    dialogButton('Weiter bearbeiten').click()
    await flushPromises()
    expect(labels(wrapper)).toEqual(['Polter Süd', 'Polter Nord', 'Waldweg Ost'])
  })
})

describe('the feedback beside the count', () => {
  /** The results bar: "8 Merkmale" and what stands next to it. */
  const bar = (wrapper: VueWrapper) => wrapper.get('p.text-lg').element.parentElement!
  const beside = (wrapper: VueWrapper) => bar(wrapper).textContent!.replace(/\s+/g, ' ').trim()

  it('tells the intro that the order is saved at once', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1 + p').text()).toContain(
      'Die Reihenfolge änderst du per Ziehen, sie wird sofort gespeichert. Änderungen kommen beim nächsten Synchronisieren auf die Handys.',
    )
  })

  it('confirms a saved order next to the count, then goes away after about 3 seconds', async () => {
    const { wrapper } = await open()
    expect(beside(wrapper)).toBe('8 Merkmale')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()

    expect(beside(wrapper)).toBe('8 Merkmale Reihenfolge gespeichert')
    const confirmation = bar(wrapper).querySelector('svg.lucide-check')
    expect(confirmation).not.toBeNull()
    // the screen reader hears it in the live region, not from the bar
    expect(bar(wrapper).querySelector('[aria-hidden=true]')!.textContent).toContain(
      'Reihenfolge gespeichert',
    )
    vi.advanceTimersByTime(2900)
    await flushPromises()
    expect(beside(wrapper)).toContain('Reihenfolge gespeichert')

    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(beside(wrapper)).toBe('8 Merkmale')
    vi.useRealTimers()
  })

  it('starts the three seconds again with the next move', async () => {
    const { wrapper } = await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()
    vi.advanceTimersByTime(2000)
    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()
    vi.advanceTimersByTime(2000)
    await flushPromises()

    expect(beside(wrapper)).toContain('Reihenfolge gespeichert')
    vi.advanceTimersByTime(1100)
    await flushPromises()
    expect(beside(wrapper)).toBe('8 Merkmale')
    vi.useRealTimers()
  })

  it('shows the error in the same place, and it stays until the next try', async () => {
    const { wrapper, api } = await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    api.attributes.failOrder()

    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()

    const alert = bar(wrapper).querySelector('[role=alert]')!
    expect(alert.textContent!.trim()).toBe(
      'Die Reihenfolge konnte nicht gespeichert werden. Sie ist wieder wie vorher.',
    )
    expect(beside(wrapper)).not.toContain('Reihenfolge gespeichert')
    vi.advanceTimersByTime(60000)
    await flushPromises()
    expect(bar(wrapper).querySelector('[role=alert]')).not.toBeNull()

    api.attributes.failOrder(false)
    await press(wrapper, 'Holzart', 'ArrowDown')
    await flushPromises()
    expect(bar(wrapper).querySelector('[role=alert]')).toBeNull()
    expect(beside(wrapper)).toBe('8 Merkmale Reihenfolge gespeichert')
    vi.useRealTimers()
  })
})
