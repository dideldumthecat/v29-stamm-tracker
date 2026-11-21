import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DashboardPileSection, DashboardResponse } from '@v29/shared/contract'
import dashboardFixture from '@v29/shared/fixtures/dashboard-response.json' with { type: 'json' }

import PileCard from '@/components/PileCard.vue'
import { popup, pressEscape, stubBrowser } from './popup'

const piles = (dashboardFixture as DashboardResponse).sections.filter(
  (section): section is DashboardPileSection => section.type === 'pile',
)
const [fiveWeeks, manyWeeks, empty] = piles as [
  DashboardPileSection,
  DashboardPileSection,
  DashboardPileSection,
]

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()
const show = (section: DashboardPileSection) =>
  mount(PileCard, { props: { section }, attachTo: document.body })

enableAutoUnmount(afterEach)
beforeEach(() => stubBrowser())
afterEach(() => vi.restoreAllMocks())

describe('pile card', () => {
  it('has the three piles of the fixture: five weeks, more weeks than fit in a row, and an empty one', () => {
    expect(piles.map((pile) => pile.weeks.length)).toEqual([5, 16, 0])
  })

  it('shows title, subtitle with the map link, progress and yield of a pile', () => {
    const wrapper = show(fiveWeeks)

    expect(wrapper.get('h2').text()).toBe('Polter 2601-010145 (Krummes F)')
    expect(squeezed(wrapper.get('[data-subtitle]').text())).toBe(
      '7 Stämme · 51,52 Rm · In OpenStreetMap öffnen',
    )
    const link = wrapper.get('[data-subtitle] a')
    expect(link.attributes('href')).toBe(
      'https://www.openstreetmap.org/?mlat=51.3132&mlon=12.3715#map=16/51.3132/12.3715',
    )
    expect(link.attributes('target')).toBe('_blank')

    const progress = wrapper.get('[data-progress]')
    expect(squeezed(progress.text())).toBe('Fortschritt85,7 %5 gesägt1 nicht sägbar1 offen')
    expect(progress.get('[role=img]').attributes('aria-label')).toBe(
      '5 gesägt, 1 nicht sägbar, 1 offen',
    )
    // the parts are as wide as their counts
    expect(progress.findAll('[role=img] > span').map((part) => part.attributes('style'))).toEqual([
      'flex: 5 1 0%;',
      'flex: 1 1 0%;',
      'flex: 1 1 0%;',
    ])

    const yieldArea = wrapper.get('[data-yield]')
    expect(squeezed(yieldArea.text())).toBe(
      'Ausbeute42,3 %1,29 m³ Schnittholz1,76 fm Verschnitt (Rinde, Schwarten, Späne)aus 3,05 fm Rundholz der gesägten Stämme',
    )
    expect(yieldArea.get('[role=img] span').attributes('style')).toContain('width: 42.29')
  })

  it('draws a column per week with the sum above, the label below and the current week as "bis heute"', () => {
    const wrapper = show(fiveWeeks)

    const columns = wrapper.findAll('ol > li')
    expect(
      columns.map((column) =>
        ['.font-bold', '.font-semibold', '.text-caption']
          .map((part) => column.get(part).text())
          .join(' | '),
      ),
    ).toEqual([
      '4 | KW 43 | 19.–25.10.',
      '4 | KW 44 | 26.10.–1.11.',
      '1 | KW 45 | 2.–8.11.',
      '4 | KW 46 | 9.–15.11.',
      '3 | KW 47 | bis heute',
    ])
    // large below (black), small above (grey), the heights add up to the scale
    const [first] = columns
    const bars = first!.findAll('span.block[class*="bg-"]')
    expect(bars.map((bar) => bar.classes()[1])).toEqual(['bg-beam-small', 'bg-beam-large'])
    expect(
      wrapper
        .get('section')
        .findAll('h3')
        .map((h3) => h3.text()),
    ).toEqual(['Fortschritt', 'Ausbeute', 'Gesägte Balken pro Woche'])
    expect(squeezed(wrapper.get('section > div:last-child ul').text())).toBe(
      'Balken 14×14Balken 10×14 Ø 3,3 pro Woche',
    )
  })

  it('writes two lines above a column: the sum, and large / small with both numbers, none for an empty week', () => {
    const wrapper = show({
      ...fiveWeeks,
      weeks: [
        { week_start: '2026-11-02', large: 3, small: 2 },
        { week_start: '2026-11-09', large: 15, small: 0 },
        { week_start: '2026-11-16', large: 0, small: 0 },
      ],
    })

    const lines = wrapper
      .findAll('ol > li')
      .map((column) => [
        column.get('.font-bold').text(),
        column.find('[data-split]').exists() ? column.get('[data-split]').text() : null,
      ])
    expect(lines).toEqual([
      ['5', '3 / 2'],
      ['15', '15 / 0'],
      ['0', null],
    ])
    const [large, small] = wrapper.get('[data-split]').findAll('span')
    expect(large!.classes()).toEqual(['font-bold', 'text-beam-large'])
    expect(small!.classes()).toEqual(['text-beam-small-text'])
  })

  it('lists every value in the label of the chart', () => {
    const label = show(fiveWeeks)
      .get('[aria-label^="Gesägte Balken pro Woche"]')
      .attributes('aria-label')!

    expect(label).toContain('KW 43 (19.–25.10.): 4 insgesamt, 2 Balken 14×14, 2 Balken 10×14')
    expect(label).toContain('KW 47 (bis heute): 3 insgesamt, 1 Balken 14×14, 2 Balken 10×14')
    expect(label).toContain('Durchschnitt 3,3 pro Woche')
  })

  it('draws the average over the whole width, and the weeks of the year end as they are', () => {
    const wrapper = show(manyWeeks)

    expect(wrapper.findAll('ol > li')).toHaveLength(16)
    expect(wrapper.find('svg[data-average]').exists()).toBe(true)
    expect(wrapper.findAll('svg[data-average] line')).toHaveLength(1)
    expect(wrapper.findAll('ol > li')[4]!.text()).toContain('0')
  })

  it('starts at the current week and fades the older weeks out while they are hidden', async () => {
    const wrote: number[] = []
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1400)
    vi.spyOn(Element.prototype, 'scrollLeft', 'set').mockImplementation((value) => {
      wrote.push(value)
    })
    vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockReturnValue(1000)
    const wrapper = show(manyWeeks)
    await flushPromises()

    expect(wrote).toContain(1400)
    expect(wrapper.find('[data-fade]').exists()).toBe(true)

    vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockReturnValue(0)
    await wrapper.get('.overflow-x-auto').trigger('scroll')
    expect(wrapper.find('[data-fade]').exists()).toBe(false)
  })

  it('has no fade where nothing is hidden', async () => {
    const wrapper = show(fiveWeeks)
    await flushPromises()

    expect(wrapper.find('[data-fade]').exists()).toBe(false)
  })

  it('says that an empty pile has nothing processed and shows no chart', () => {
    const wrapper = show(empty)

    expect(wrapper.get('h2').text()).toBe('Polter 2601-010170 (Lindenallee)')
    expect(squeezed(wrapper.get('[data-subtitle]').text())).toBe('2 Stämme')
    expect(squeezed(wrapper.get('[data-progress]').text())).toBe(
      'Fortschritt0 %Noch kein Stamm verarbeitet',
    )
    expect(squeezed(wrapper.get('[data-yield]').text())).toBe('Ausbeute–Noch kein Stamm gesägt')
    expect(wrapper.find('ol').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Gesägte Balken pro Woche')
  })

  it('leaves out the volume and the link where the pile has none', () => {
    const wrapper = show({ ...fiveWeeks, stacked_volume: null, latitude: null, longitude: null })

    expect(squeezed(wrapper.get('[data-subtitle]').text())).toBe('7 Stämme')
  })

  it('has no line and no legend entry for the average without a completed week', () => {
    const wrapper = show({
      ...fiveWeeks,
      weeks: [{ week_start: '2026-11-16', large: 1, small: 0 }],
      average_per_week: null,
    })

    expect(wrapper.find('svg[data-average]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Ø')
    expect(wrapper.get('ol').text()).toContain('bis heute')
  })

  it('explains the calculation under the info button', async () => {
    const wrapper = show(fiveWeeks)

    await wrapper
      .get('button[aria-label="Erklärung zeigen: Polter 2601-010145 (Krummes F)"]')
      .trigger('click')
    expect([...popup()!.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(
      fiveWeeks.notes.map((note) => note.term),
    )
    pressEscape()
    await flushPromises()
    expect(popup()).toBeNull()
  })
})
