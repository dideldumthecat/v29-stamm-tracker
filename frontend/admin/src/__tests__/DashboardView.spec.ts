import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import type {
  DashboardCardsSection,
  DashboardDiameterSection,
  DashboardResponse,
} from '@v29/shared/contract'
import dashboardFixture from '@v29/shared/fixtures/dashboard-response.json' with { type: 'json' }

import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'
import { popup, pressEscape, stubBrowser } from './popup'

const CODE = 'K7QM-4XHT-9RDP'
const fixture = dashboardFixture as DashboardResponse
const roundWood = fixture.sections[0] as DashboardCardsSection
const byDiameter = fixture.sections[2] as DashboardDiameterSection

async function open(prepare: (api: ReturnType<typeof fakeApi>) => void = () => {}) {
  const api = fakeApi({ [CODE]: 'admin' })
  prepare(api)
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(CODE)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  return { api, wrapper }
}

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()
const sectionOf = (wrapper: VueWrapper, heading: string) =>
  wrapper.findAll('section').find((section) => section.get('h2').text() === heading)!
const cardsOf = (wrapper: VueWrapper, heading: string) =>
  sectionOf(wrapper, heading).findAll('dl > div')
const cells = (wrapper: VueWrapper, heading: string) =>
  cardsOf(wrapper, heading).map((cell) =>
    squeezed(
      cell
        .findAll('dt, dd')
        .map((part) => part.text())
        .join(' '),
    ),
  )

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => vi.unstubAllGlobals())

describe('dashboard', () => {
  it('is the page after signing in, with the time of the last sync and the cards of each section', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Dashboard')
    expect(wrapper.text()).toContain('Letzter Sync: 19.11.2026, 11:54')
    expect(wrapper.findAll('h2').map((h2) => h2.text())).toEqual([
      'Rundholz',
      'Schnittholz',
      'Stämme nach Mittendurchmesser',
    ])
    expect(sectionOf(wrapper, 'Rundholz').get('p').text()).toBe('In Stämmen und Raummetern (Rm)')
    expect(cells(wrapper, 'Rundholz')).toEqual([
      'Gepoltert 5 Stämme 10,00 Rm',
      'Bearbeitet 4 Stämme 80,0 % ≈ 10,00 Rm',
      'Nicht sägbar 1 Stamm 25,0 % der bearbeiteten',
      'Rundholz bearbeitet 1,12 fm 4 bearbeitete Stämme',
      'Tempo 1,5 Stämme / Woche ≈ 3,75 Rm / Woche',
      'Vorrat reicht bis ca. KW 48 1 Stamm ≈ 0,00 Rm offen',
    ])
    expect(cells(wrapper, 'Schnittholz')).toEqual([
      'Gesägt gesamt 6 Balken 0,46 m³ · aus 3 Stämmen',
      '14×14 (groß) 3 Balken 50 % der Balken',
      '10×14 (klein) 3 Balken 50 % der Balken',
      'Ausbeute 55,0 % 3 gesägte Stämme',
    ])
  })

  it('starts a row, frames the highlighted card and marks the beam sizes as the server says', async () => {
    const { wrapper } = await open()
    const card = (heading: string, label: string) =>
      cardsOf(wrapper, heading).find((card) => card.get('dt').text() === label)!

    expect(card('Rundholz', 'Tempo').classes()).toContain('sm:col-start-1')
    expect(
      cardsOf(wrapper, 'Rundholz').filter((card) => card.classes('sm:col-start-1')),
    ).toHaveLength(1)
    expect(card('Rundholz', 'Vorrat reicht bis ca.').classes()).toContain('border-accent')
    expect(card('Rundholz', 'Gepoltert').classes()).not.toContain('border-accent')
    expect(card('Schnittholz', '14×14 (groß)').get('dt > [aria-hidden]').classes()).toContain(
      'bg-beam-large',
    )
    expect(card('Schnittholz', '10×14 (klein)').get('dt > [aria-hidden]').classes()).toContain(
      'bg-beam-small',
    )
    expect(card('Schnittholz', 'Ausbeute').find('dt > [aria-hidden]').exists()).toBe(false)
  })

  it('shows a further section without knowing it, and no sync line without events', async () => {
    const sorting: DashboardCardsSection = {
      type: 'cards',
      key: 'sorting',
      label: 'Sortieren',
      description: null,
      cards: [
        {
          ...roundWood.cards[0]!,
          key: 'sorted',
          label: 'Sortiert',
          value: '1.300',
          secondary: null,
        },
        { ...roundWood.cards[4]!, value: '–', unit: null, secondary: null },
      ],
    }
    const { wrapper } = await open((api) =>
      api.setDashboard({ last_sync_at: null, sections: [...fixture.sections, sorting] }),
    )

    expect(wrapper.findAll('h2').map((h2) => h2.text())).toEqual([
      'Rundholz',
      'Schnittholz',
      'Stämme nach Mittendurchmesser',
      'Sortieren',
    ])
    expect(cells(wrapper, 'Sortieren')).toEqual(['Sortiert 1.300 Stämme', 'Tempo –'])
    expect(sectionOf(wrapper, 'Sortieren').get('[role=img]').attributes('aria-label')).toBe(
      'nicht berechenbar',
    )
    expect(sectionOf(wrapper, 'Sortieren').find('p').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Letzter Sync')
  })

  it('opens the formula under the info button, one at a time', async () => {
    const { wrapper } = await open()
    const info = (name: string) => wrapper.get(`button[aria-label="Formel für ${name} anzeigen"]`)

    await info('Ausbeute').trigger('click')
    expect(squeezed(popup()!.textContent!)).toBe(
      'So wird Ausbeute berechnet' +
        'FormelSchnittholz ÷ Rundholz der gesägten Stämme' +
        'Eingesetzt0,46 m³ ÷ 0,83 fm' +
        'Ergebnis55,0 %' +
        'Nur gesägte Stämme gehen ein. Als gesägt zählt ein Stamm, wenn Gesägt angehakt ist, Balken vorhanden sind oder Gesägter Querschnitt erfasst ist. Stämme mit Häkchen bei Nicht sägbar zählen nicht.',
    )

    await info('Nicht sägbar').trigger('click')
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
    expect(squeezed(popup()!.textContent!)).toContain('Ergebnis1 Stamm')

    pressEscape()
    await flushPromises()
    expect(popup()).toBeNull()
  })

  it('reports a failing request and tries again', async () => {
    const { api, wrapper } = await open((api) => api.failDashboard())

    expect(wrapper.get('[role=alert]').text()).toContain('Auf dem Server ist etwas schiefgelaufen.')

    api.failDashboard(false)
    await wrapper.get('[role=alert] button').trigger('click')
    await flushPromises()
    expect(cells(wrapper, 'Rundholz')).toHaveLength(6)
  })

  describe('stems by diameter', () => {
    const table = (wrapper: VueWrapper) => wrapper.get('table')
    const rows = (wrapper: VueWrapper) =>
      table(wrapper)
        .findAll('tbody tr')
        .map((row) =>
          row
            .findAll('th, td')
            .map((cell) => squeezed(cell.text()))
            .join(' | '),
        )
    const diameters = (wrapper: VueWrapper) =>
      table(wrapper)
        .findAll('tbody th')
        .map((th) => squeezed(th.text()))
    const header = (wrapper: VueWrapper, label: string) =>
      table(wrapper)
        .findAll('thead th')
        .find((th) => th.text() === label)!
    const sortBy = (wrapper: VueWrapper, label: string) =>
      header(wrapper, label).get('button').trigger('click')

    it('shows the notes as terms behind the info button, the classes by diameter descending and the row without diameter last', async () => {
      const { wrapper } = await open()

      expect(table(wrapper).element.closest('section')!.querySelector('dl')).toBeNull()
      await wrapper
        .get('button[aria-label="Erklärung zeigen: Stämme nach Mittendurchmesser"]')
        .trigger('click')
      const notes = popup()!
      expect([...notes.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
        'Stämme',
        'Durchmesser',
        'Klassen',
        'Ausbeute',
        'Balken je Stamm',
        'Groß und klein',
        'Nicht sägbar',
      ])
      expect([...notes.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(
        byDiameter.notes.map((note) => note.text),
      )
      pressEscape()
      await flushPromises()
      expect(popup()).toBeNull()

      expect(rows(wrapper)).toEqual([
        '38–39 cm | 62,1 % | 1 1 Stamm | 14×14 je Stamm 2,0 | 10×14 je Stamm 2,0 | ',
        '36–37 cm | Ausbeute – | 0 0 Stämme | 14×14 je Stamm – | 10×14 je Stamm – | ',
        '34–35 cm | Ausbeute – | 0 0 Stämme | 14×14 je Stamm – | 10×14 je Stamm – | ',
        '32–33 cm | 26,1 % | 1 1 Stamm | 14×14 je Stamm 1,0 | 10×14 je Stamm 0,0 | ',
        '30–31 cm | Ausbeute – | 1(1) 1 Stamm (1 nicht sägbar) | 14×14 je Stamm – | 10×14 je Stamm – | ',
        'Kein ⌀ |  | 11 Stamm |  |  | ',
      ])
      expect(
        table(wrapper)
          .findAll('thead th')
          .map((th) => th.text()),
      ).toEqual([
        'Durchmesser',
        'Ausbeute',
        'Stämme (nicht sägbar)',
        'Balken 14×14 je Stamm',
        'Balken 10×14 je Stamm',
        'Stammliste',
      ])
      expect(table(wrapper).element.closest('section')!.querySelector('ul')!.textContent).toMatch(
        /Schnittholz\s*Verschnitt \(Rinde, Schwarten, Späne\)/,
      )
      expect(header(wrapper, 'Durchmesser').attributes('aria-sort')).toBe('descending')
      expect(header(wrapper, 'Ausbeute').attributes('aria-sort')).toBeUndefined()
    })

    it('has an arrow per row with stems that opens the list of those stems, and none for an empty class', async () => {
      const { wrapper } = await open()

      const links = table(wrapper)
        .findAll('tbody a')
        .map((link) => [link.attributes('aria-label'), link.attributes('href')])
      expect(links).toEqual([
        ['Stämme 38–39 cm in der Stammliste zeigen', '/stems?Mittendurchmesser=38&Bearbeitet=yes'],
        ['Stämme 32–33 cm in der Stammliste zeigen', '/stems?Mittendurchmesser=32&Bearbeitet=yes'],
        ['Stämme 30–31 cm in der Stammliste zeigen', '/stems?Mittendurchmesser=30&Bearbeitet=yes'],
        [
          'Stämme ohne Durchmesser in der Stammliste zeigen',
          '/stems?Mittendurchmesser=none&Bearbeitet=yes',
        ],
      ])
      // the rows of the empty classes 36–37 and 34–35 have no arrow
      expect(
        table(wrapper)
          .findAll('tbody tr')
          .map((row) => row.findAll('a').length),
      ).toEqual([1, 0, 0, 1, 1, 1])
    })

    it('makes the whole row the click area of its one link, and rows without a link plain', async () => {
      const { wrapper } = await open()

      const rows = table(wrapper).findAll('tbody tr')
      // a row with stems is the positioning box of its stretched link; a row without has neither link nor hover
      expect(rows.map((row) => row.findAll('a').length)).toEqual([1, 0, 0, 1, 1, 1])
      const [linked, plain] = [
        rows.filter((row) => row.find('a').exists()),
        rows.filter((row) => !row.find('a').exists()),
      ]
      for (const row of rows) expect(row.classes()).toContain('relative')
      for (const row of linked) {
        expect(row.classes()).toEqual(expect.arrayContaining(['cursor-pointer', 'hover:bg-well']))
        expect(row.get('a').classes()).toContain('after:inset-0')
      }
      for (const row of plain) {
        expect(row.classes()).not.toContain('cursor-pointer')
        expect(row.classes()).not.toContain('hover:bg-well')
      }
    })

    it('opens the stem list with the two filters as chips', async () => {
      const { wrapper } = await open()

      await table(wrapper)
        .get('a[aria-label="Stämme 32–33 cm in der Stammliste zeigen"]')
        .trigger('click')
      await flushPromises()

      expect(wrapper.get('h1').text()).toBe('Stämme')
      expect(wrapper.findAll('[data-chip]').map((chip) => squeezed(chip.text()))).toEqual([
        'Mittendurchmesser: 32–33 cm',
        'Bearbeitet: ja',
      ])
    })

    it('names the stems and the unsawable ones among them for screen readers', async () => {
      const { wrapper } = await open()

      const labels = table(wrapper)
        .findAll('tbody tr:not(:last-child)')
        .map((row) => row.get('td:nth-child(3) [role=img]').attributes('aria-label'))
      expect(labels).toEqual([
        '1 Stamm',
        '0 Stämme',
        '0 Stämme',
        '1 Stamm',
        '1 Stamm, davon 1 nicht sägbar',
      ])
    })

    it('draws the dark part of each bar as wide as the percentage beside it, and none without a sawn stem', async () => {
      const { wrapper } = await open()

      const bars = table(wrapper).findAll('[aria-label^="Ausbeute"]')
      expect(
        bars.map((bar) => [
          bar.attributes('aria-label'),
          Number.parseFloat(bar.get('span').attributes('style')!.replace('width: ', '')).toFixed(1),
        ]),
      ).toEqual([
        ['Ausbeute 62,1\u00a0%', '62.1'],
        ['Ausbeute 26,1\u00a0%', '26.1'],
      ])
    })

    it('sorts on every column, a click turns the direction, the row without diameter stays last', async () => {
      const { wrapper } = await open()

      await sortBy(wrapper, 'Durchmesser')
      expect(header(wrapper, 'Durchmesser').attributes('aria-sort')).toBe('ascending')
      expect(diameters(wrapper)).toEqual([
        '30–31 cm',
        '32–33 cm',
        '34–35 cm',
        '36–37 cm',
        '38–39 cm',
        'Kein ⌀',
      ])

      // another column starts descending; equal counts by diameter descending
      await sortBy(wrapper, 'Stämme (nicht sägbar)')
      expect(header(wrapper, 'Stämme (nicht sägbar)').attributes('aria-sort')).toBe('descending')
      expect(header(wrapper, 'Durchmesser').attributes('aria-sort')).toBeUndefined()
      expect(diameters(wrapper)).toEqual([
        '38–39 cm',
        '32–33 cm',
        '30–31 cm',
        '36–37 cm',
        '34–35 cm',
        'Kein ⌀',
      ])
      await sortBy(wrapper, 'Stämme (nicht sägbar)')
      expect(diameters(wrapper)).toEqual([
        '36–37 cm',
        '34–35 cm',
        '38–39 cm',
        '32–33 cm',
        '30–31 cm',
        'Kein ⌀',
      ])

      // "–" last in both directions
      await sortBy(wrapper, 'Ausbeute')
      expect(diameters(wrapper)).toEqual([
        '38–39 cm',
        '32–33 cm',
        '36–37 cm',
        '34–35 cm',
        '30–31 cm',
        'Kein ⌀',
      ])
      await sortBy(wrapper, 'Ausbeute')
      expect(header(wrapper, 'Ausbeute').attributes('aria-sort')).toBe('ascending')
      expect(diameters(wrapper)).toEqual([
        '32–33 cm',
        '38–39 cm',
        '36–37 cm',
        '34–35 cm',
        '30–31 cm',
        'Kein ⌀',
      ])

      for (const label of ['Balken 14×14 je Stamm', 'Balken 10×14 je Stamm']) {
        await sortBy(wrapper, label)
        expect(diameters(wrapper)).toEqual([
          '38–39 cm',
          '32–33 cm',
          '36–37 cm',
          '34–35 cm',
          '30–31 cm',
          'Kein ⌀',
        ])
        await sortBy(wrapper, label)
        expect(diameters(wrapper)).toEqual([
          '32–33 cm',
          '38–39 cm',
          '36–37 cm',
          '34–35 cm',
          '30–31 cm',
          'Kein ⌀',
        ])
      }
    })

    it('has no row without diameter if every stem has one', async () => {
      const { wrapper } = await open((api) =>
        api.setDashboard({ ...fixture, sections: [{ ...byDiameter, without_diameter: 0 }] }),
      )

      expect(diameters(wrapper)).not.toContain('Kein ⌀')
    })
  })
})
