import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type DOMWrapper } from '@vue/test-utils'
import type { PileCardSection, PileCardsResponse } from '@v29/shared/contract'
import pileCardsFixture from '@v29/shared/fixtures/pile-cards-response.json' with { type: 'json' }

import PileCard from '@/components/PileCard.vue'
import { popup, pressEscape, stubBrowser } from './popup'

const piles = (pileCardsFixture as PileCardsResponse).sections
const [empty, manyWeeks, fiveWeeks] = piles as [PileCardSection, PileCardSection, PileCardSection]

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()
const figureText = (figure: DOMWrapper<Element>) => [
  figure.get('dt').text(),
  figure.get('dd').text(),
]
const show = (section: PileCardSection) =>
  mount(PileCard, { props: { section }, attachTo: document.body })

const beamsChart = (wrapper: ReturnType<typeof show>) =>
  wrapper.get('[role=img][aria-label^="Gesägte Balken pro Woche"]')
const stemsChart = (wrapper: ReturnType<typeof show>) =>
  wrapper.get('[role=img][aria-label^="Bearbeitete Stämme pro Woche"]')

enableAutoUnmount(afterEach)
beforeEach(() => stubBrowser())
afterEach(() => vi.restoreAllMocks())

describe('pile card', () => {
  it('has the three piles of the fixture, the newest first: an empty one, more weeks than fit in a row, and five weeks', () => {
    expect(piles.map((pile) => pile.weeks.length)).toEqual([0, 16, 5])
  })

  it('shows title, subtitle with the map link, progress of a pile', () => {
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
    expect(progress.get('p').classes()).toEqual(
      expect.arrayContaining(['font-bold', 'tabular-nums']),
    )
    expect(progress.get('[role=img]').attributes('aria-label')).toBe(
      '5 gesägt, 1 nicht sägbar, 1 offen',
    )
    // the parts are as wide as their counts
    expect(progress.findAll('[role=img] > span').map((part) => part.attributes('style'))).toEqual([
      'flex: 5 1 0%;',
      'flex: 1 1 0%;',
      'flex: 1 1 0%;',
    ])
  })

  it('shows the beams by size and the sawn timber as three figures under "Ausbeute"', () => {
    const wrapper = show(fiveWeeks)

    const figures = wrapper.findAll('[data-yield] dl > div')
    expect(figures.map(figureText)).toEqual([
      ['14×14 (groß)', '11Stück'],
      ['10×14 (klein)', '5Stück'],
      ['Schnittholz', '1,29fm'],
    ])
    expect(figures.map((figure) => figure.classes())).toEqual([
      expect.arrayContaining(['bg-beam-large']),
      expect.arrayContaining(['bg-beam-small']),
      expect.arrayContaining(['bg-paper', 'border-line']),
    ])
  })

  it('shows 0 beams and a dash for the sawn timber of a pile without a sawn stem', () => {
    const figures = show(empty).findAll('[data-yield] dl > div')

    expect(figures.map(figureText)).toEqual([
      ['14×14 (groß)', '0Stück'],
      ['10×14 (klein)', '0Stück'],
      ['Schnittholz', '–'],
    ])
    expect(figures[2]!.get('[role=img]').attributes('aria-label')).toBe('nicht berechenbar')
  })

  it('draws a column per week with the sum above, the label below and the current week as "bis heute"', () => {
    const wrapper = show(fiveWeeks)

    const columns = beamsChart(wrapper).findAll('ol > li')
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
    ).toEqual([
      'Fortschritt',
      'Ausbeute',
      'Bearbeitete Stämme pro Woche',
      'Gesägte Balken pro Woche',
    ])
    expect(squeezed(wrapper.get('section > div:last-child ul').text())).toBe(
      '14×14 (groß)10×14 (klein) Ø 3,3 pro Woche',
    )
  })

  it('draws the processed stems above the beams: one black column per week, the number above it, the average and a lower chart', () => {
    const wrapper = show(fiveWeeks)
    const chart = stemsChart(wrapper)

    expect(
      chart
        .findAll('ol > li')
        .map((column) => [
          column.get('.font-bold').text(),
          column.get('.font-semibold').text(),
          column.find('[data-split]').exists(),
        ]),
    ).toEqual([
      ['1', 'KW 43', false],
      ['1', 'KW 44', false],
      ['1', 'KW 45', false],
      ['1', 'KW 46', false],
      ['2', 'KW 47', false],
    ])
    expect(
      chart.findAll('ol > li')[0]!.findAll('span.block[class*="bg-"]')[0]!.classes(),
    ).toContain('bg-ink')
    expect(squeezed(chart.element.parentElement!.querySelector('ul')!.textContent!)).toBe(
      'Gesägt oder nicht sägbar Ø 1,0 pro Woche',
    )
    expect(chart.find('svg[data-average]').exists()).toBe(true)
    // lower than the chart of the beams: about two thirds
    expect(chart.get('ol > li > div').attributes('style')).toContain('height: 132px')
    expect(beamsChart(wrapper).get('ol > li > div').attributes('style')).toContain('height: 204px')
  })

  it('lists every week of the stems in the label of their chart', () => {
    const label = stemsChart(show(fiveWeeks)).attributes('aria-label')!

    expect(label).toContain('KW 43 (19.–25.10.): 1 Stamm; KW 44')
    expect(label).toContain('KW 47 (bis heute): 2 Stämme')
    expect(label).toContain('Durchschnitt 1,0 pro Woche')
  })

  it('writes two lines above a column: the sum, and large / small with both numbers, none for an empty week', () => {
    const wrapper = show({
      ...fiveWeeks,
      weeks: [
        { week_start: '2026-11-02', large: 3, small: 2, stems: 1 },
        { week_start: '2026-11-09', large: 15, small: 0, stems: 2 },
        { week_start: '2026-11-16', large: 0, small: 0, stems: 0 },
      ],
    })

    const lines = beamsChart(wrapper)
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
    const [large, small] = beamsChart(wrapper).get('[data-split]').findAll('span')
    expect(large!.classes()).toEqual(['font-bold', 'text-body'])
    expect(small!.classes()).toEqual(['text-beam-small-text'])
  })

  it('lists every value in the label of the chart', () => {
    const label = beamsChart(show(fiveWeeks)).attributes('aria-label')!

    expect(label).toContain(
      'KW 43 (19.–25.10.): 4 insgesamt, 2 Balken 14×14 (groß), 2 Balken 10×14 (klein)',
    )
    expect(label).toContain(
      'KW 47 (bis heute): 3 insgesamt, 1 Balken 14×14 (groß), 2 Balken 10×14 (klein)',
    )
    expect(label).toContain('Durchschnitt 3,3 pro Woche')
  })

  it('draws the average over the whole width, and the weeks of the year end as they are', () => {
    const wrapper = show(manyWeeks)

    const beams = beamsChart(wrapper)
    expect(beams.findAll('ol > li')).toHaveLength(16)
    expect(stemsChart(wrapper).findAll('ol > li')).toHaveLength(16)
    expect(beams.find('svg[data-average]').exists()).toBe(true)
    expect(beams.findAll('svg[data-average] line')).toHaveLength(1)
    expect(beams.findAll('ol > li')[4]!.text()).toContain('0')
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
    expect(wrapper.findAll('[data-fade]')).toHaveLength(2)

    // each chart scrolls on its own
    vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockReturnValue(0)
    await beamsChart(wrapper).get('.overflow-x-auto').trigger('scroll')
    expect(beamsChart(wrapper).find('[data-fade]').exists()).toBe(false)
    expect(stemsChart(wrapper).find('[data-fade]').exists()).toBe(true)
  })

  describe('scroll arrows', () => {
    const scrollBy = vi.fn()
    const scrolled = (left: number) => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1400)
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
      vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockReturnValue(left)
      vi.spyOn(Element.prototype, 'scrollLeft', 'set').mockImplementation(() => {})
    }
    const arrow = (wrapper: ReturnType<typeof show>, side: 'links' | 'rechts') =>
      wrapper.find(`button[aria-label="Gesägte Balken pro Woche: nach ${side} scrollen"]`)

    beforeEach(() => {
      scrollBy.mockClear()
      // jsdom does not scroll elements
      Object.defineProperty(Element.prototype, 'scrollBy', { value: scrollBy, configurable: true })
    })
    afterEach(() => {
      delete (Element.prototype as { scrollBy?: unknown }).scrollBy
    })

    it('are not there while the columns fit', async () => {
      const wrapper = show(fiveWeeks)
      await flushPromises()

      expect(arrow(wrapper, 'links').exists()).toBe(false)
      expect(arrow(wrapper, 'rechts').exists()).toBe(false)
      expect(wrapper.findAll('button[aria-label$="scrollen"]')).toHaveLength(0)
    })

    it('belong to their own chart: the one of the stems has two of its own', async () => {
      scrolled(1000)
      const wrapper = show(manyWeeks)
      await flushPromises()

      expect(
        wrapper
          .findAll('button[aria-label$="scrollen"]')
          .map((button) => button.attributes('aria-label')),
      ).toEqual([
        'Bearbeitete Stämme pro Woche: nach links scrollen',
        'Bearbeitete Stämme pro Woche: nach rechts scrollen',
        'Gesägte Balken pro Woche: nach links scrollen',
        'Gesägte Balken pro Woche: nach rechts scrollen',
      ])
    })

    it('start with "right" disabled at the current week, and "left" scrolls back by 60 % of the width', async () => {
      scrolled(1000)
      const wrapper = show(manyWeeks)
      await flushPromises()

      expect(arrow(wrapper, 'links').attributes('disabled')).toBeUndefined()
      expect(arrow(wrapper, 'rechts').attributes('disabled')).toBeDefined()
      await arrow(wrapper, 'links').trigger('click')
      expect(scrollBy).toHaveBeenCalledWith({ left: -240, behavior: 'smooth' })
    })

    it('disable "left" at the oldest week, and "right" scrolls forward', async () => {
      scrolled(0)
      const wrapper = show(manyWeeks)
      await flushPromises()
      await beamsChart(wrapper).get('.overflow-x-auto').trigger('scroll')

      expect(arrow(wrapper, 'links').attributes('disabled')).toBeDefined()
      expect(arrow(wrapper, 'rechts').attributes('disabled')).toBeUndefined()
      await arrow(wrapper, 'rechts').trigger('click')
      expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' })
    })

    it('scroll without animation when the system asks for less motion', async () => {
      scrolled(0)
      vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const wrapper = show(manyWeeks)
      await flushPromises()
      await beamsChart(wrapper).get('.overflow-x-auto').trigger('scroll')

      await arrow(wrapper, 'rechts').trigger('click')
      expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'auto' })
    })
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
    expect(wrapper.find('ol').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Gesägte Balken pro Woche')
    expect(wrapper.text()).not.toContain('Bearbeitete Stämme pro Woche')
  })

  it('leaves out the volume and the link where the pile has none', () => {
    const wrapper = show({ ...fiveWeeks, stacked_volume: null, latitude: null, longitude: null })

    expect(squeezed(wrapper.get('[data-subtitle]').text())).toBe('7 Stämme')
  })

  it('has no line and no legend entry for the average without a completed week', () => {
    const wrapper = show({
      ...fiveWeeks,
      weeks: [{ week_start: '2026-11-16', large: 1, small: 0, stems: 1 }],
      average_per_week: null,
      stems_average_per_week: null,
    })

    expect(wrapper.find('svg[data-average]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Ø')
    expect(wrapper.findAll('ol')).toHaveLength(2)
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
