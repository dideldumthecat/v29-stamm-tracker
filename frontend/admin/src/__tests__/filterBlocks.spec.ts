import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import ColumnFilterButton from '@/components/ColumnFilterButton.vue'
import FilterButton from '@/components/FilterButton.vue'
import FilterChips from '@/components/FilterChips.vue'
import FilterText from '@/components/FilterText.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import { buildColumns, buildRows } from '@/stemlist'
import { snapshotFixture } from './fakeSnapshot'
import { popup, pressEscape, stubBrowser } from './popup'

enableAutoUnmount(afterEach)
beforeEach(stubBrowser)
afterEach(() => vi.unstubAllGlobals())

const chips = [
  { id: 'a', name: 'Polternummer', text: 'Polternummer: 03, 04' },
  { id: 'tags', name: 'Kennung', text: 'Kennung: 100-120' },
]

describe('FilterChips', () => {
  it('lists the chips with a text button that opens and a cross that removes, named after the filter', async () => {
    const wrapper = mount(FilterChips, { props: { chips } })
    expect(wrapper.get('ul').attributes('aria-label')).toBe('Aktive Filter')
    const items = wrapper.findAll('li')
    expect(items.map((item) => item.get('button').text())).toEqual([
      'Polternummer: 03, 04',
      'Kennung: 100-120',
    ])
    expect(items.map((item) => item.findAll('button')[1].attributes('aria-label'))).toEqual([
      'Filter Polternummer entfernen',
      'Filter Kennung entfernen',
    ])

    await items[1].findAll('button')[0].trigger('click')
    await items[0].findAll('button')[1].trigger('click')
    expect(wrapper.emitted('open')).toEqual([['tags']])
    expect(wrapper.emitted('remove')).toEqual([['a']])
  })

  it('shows no list without a chip', () => {
    expect(
      mount(FilterChips, { props: { chips: [] } })
        .find('ul')
        .exists(),
    ).toBe(false)
  })
})

describe('ResultsBar', () => {
  it('has the count first, then the chips, and the slot at the right; it passes the events of the chips on', async () => {
    const wrapper = mount(ResultsBar, {
      props: { text: '12 von 130 Stämmen', chips },
      slots: { end: '<button>Pfeile</button>' },
    })
    const [text, ...rest] = wrapper.get('.page-column').element.firstElementChild!.children
    expect(text.textContent).toBe('12 von 130 Stämmen')
    expect(rest[0].getAttribute('aria-label')).toBe('Aktive Filter')
    expect(wrapper.get('.page-column').element.lastElementChild!.textContent).toBe('Pfeile')
    // it wraps instead of cutting chips off
    expect(wrapper.get('.page-column > div').classes()).toContain('flex-wrap')

    await wrapper.get('[data-chip="a"]').trigger('click')
    await wrapper.get('button[aria-label="Filter Kennung entfernen"]').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['a']])
    expect(wrapper.emitted('remove')).toEqual([['tags']])
  })

  it('leaves out the count when there is no text yet (an answer 400 on the first page)', () => {
    const wrapper = mount(ResultsBar, { props: { text: '', chips } })
    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.findAll('li')).toHaveLength(2)
  })
})

describe('FilterButton', () => {
  const button = (props: Record<string, unknown>) =>
    mount(FilterButton, {
      props: { id: 'x', name: 'Polternummer', ...props },
      slots: { default: '<p>Inhalt</p>' },
      attachTo: document.body,
    })

  it('shows the name, the badge only with a number, and an arrow down that turns up while open', async () => {
    const wrapper = button({ count: 2, active: true })
    const trigger = wrapper.get('button')
    expect(trigger.text()).toBe('Polternummer 2')
    expect(trigger.get('span').classes()).toEqual(
      expect.arrayContaining(['bg-ink', 'text-paper', 'font-bold', 'rounded-full']),
    )
    // set: white with a black border, bold; not set: transparent with a grey border
    expect(trigger.classes()).toEqual(
      expect.arrayContaining(['border-ink', 'bg-paper', 'font-bold']),
    )
    expect(trigger.find('svg.lucide-chevron-down').exists()).toBe(true)

    await trigger.trigger('click')
    expect(trigger.find('svg.lucide-chevron-up').exists()).toBe(true)
    expect(trigger.attributes('aria-expanded')).toBe('true')

    const idle = button({ name: 'Anderes' }).get('button')
    expect(idle.find('span').exists()).toBe(false)
    expect(idle.classes()).toEqual(expect.arrayContaining(['border-dim', 'bg-transparent']))
    expect(idle.classes()).not.toContain('font-bold')
  })

  it('opens the content under the button, closes with Escape and gives the focus back to the button', async () => {
    const wrapper = button({})
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(popup()!.textContent).toBe('Inhalt')
    expect(popup()!.getAttribute('aria-label')).toBe('Polternummer')
    expect(popup()!.getAttribute('data-side')).toBe('bottom')

    pressEscape()
    await flushPromises()
    expect(popup()).toBeNull()
    expect(document.activeElement).toBe(wrapper.get('button').element)
  })
})

describe('ColumnFilterButton', () => {
  const columns = buildColumns(snapshotFixture.attributes, 'stem')
  const rows = buildRows(snapshotFixture, 'stem', columns)
  const column = (name: string) => columns.find((candidate) => candidate.label === name)!
  const open = async (name: string, filter: object | null) => {
    const wrapper = mount(ColumnFilterButton, {
      props: { column: column(name), filter: filter as never, rows },
      attachTo: document.body,
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    return wrapper
  }
  const labels = () => [...popup()!.querySelectorAll('label')].map((l) => l.textContent!.trim())

  it('offers ticks for a choice, with the badge counting the ticked ones and "Nicht erfasst" under a line', async () => {
    const wrapper = await open('Holzart', { kind: 'pick', picks: ['none'] })
    expect(wrapper.get('button').text()).toBe('Holzart 1')
    expect(labels()).toEqual(['Traubeneiche', 'Stieleiche', 'Nicht erfasst'])
    expect(popup()!.querySelector('li.border-t')!.textContent!.trim()).toBe('Nicht erfasst')
    expect(popup()!.querySelectorAll('input[type=checkbox]:checked')).toHaveLength(1)

    popup()!.querySelector<HTMLInputElement>('input')!.click()
    expect(wrapper.emitted('change')![0]).toEqual([
      { kind: 'pick', picks: ['none', expect.any(String)] },
      false,
    ])
  })

  it('offers "ja" and "nein" for yes/no, and a range with the unit and "Nicht erfasst" for a number', async () => {
    await open('Gesägt', null)
    expect(labels()).toEqual(['ja', 'nein', 'Nicht erfasst'])
  })

  it('has no badge for a range, and from–to with "Nicht erfasst" as the alternative', async () => {
    const wrapper = await open('Holzfeuchte', { kind: 'range', from: '30', to: '40' })
    expect(wrapper.get('button').text()).toBe('Holzfeuchte')
    expect(labels()).toEqual(['Bereich', 'Von', 'Bis', 'Nicht erfasst'])
    expect(popup()!.textContent).toContain('%')
    expect(
      [...popup()!.querySelectorAll<HTMLInputElement>('input[inputmode=decimal]')].map(
        (i) => i.value,
      ),
    ).toEqual(['30', '40'])
  })

  it('offers a day range for a date, from–to for the beams without the alternative, and a text search', async () => {
    await open('Lieferdatum', null)
    expect(popup()!.querySelectorAll('input[type=date]')).toHaveLength(2)
    expect(labels()).toContain('Zeitraum')
    pressEscape()
    await flushPromises()
    await open('Balken', null)
    expect(labels()).toEqual(['Von', 'Bis'])
    pressEscape()
    await flushPromises()
    await open('Notiz', null)
    expect(labels()).toEqual(['Enthält', 'Vorhanden', 'Nicht erfasst'])
    expect(popup()!.querySelector('input[aria-label="Suchtext"]')).not.toBeNull()
  })
})

describe('FilterText', () => {
  it('takes a text, "vorhanden" or "nicht erfasst" as alternatives, and for photos with or without', async () => {
    const wrapper = mount(FilterText, { props: { type: 'photo', filter: null } })
    expect(wrapper.findAll('label').map((label) => label.text())).toEqual([
      'Mit Fotos',
      'Ohne Fotos',
    ])
    await wrapper.findAll('input')[1].setValue(true)
    expect(wrapper.emitted('change')).toEqual([[{ kind: 'none' }, false]])
  })
})
