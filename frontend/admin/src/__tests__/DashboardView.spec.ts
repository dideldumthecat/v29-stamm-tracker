import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import type {
  DashboardDiameterSection,
  DashboardFiguresSection,
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
const sawing = fixture.sections[0] as DashboardFiguresSection
const byDiameter = fixture.sections[1] as DashboardDiameterSection

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
const cells = (wrapper: VueWrapper, heading: string) =>
  wrapper
    .findAll('section')
    .find((section) => section.get('h2').text() === heading)!
    .findAll('dl > div')
    .map((cell) => squeezed(cell.text()))

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => vi.unstubAllGlobals())

describe('dashboard', () => {
  it('is the page after signing in, with the time of the last sync and the figures of each section', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Dashboard')
    expect(wrapper.text()).toContain('Letzter Sync: 19.11.2026, 11:54')
    expect(cells(wrapper, 'Kennzahlen: Sägen')).toEqual([
      'Stämme gesamt 5',
      'Stämme bearbeitet 4',
      'Stämme nicht bearbeitet 1',
      'Rundholz bearbeitet 1,13fm',
      'Schnittholz 0,46m³',
      'Ausbeute 54,1%',
    ])
  })

  it('shows a further section without knowing it, and no sync line without events', async () => {
    const sorting: DashboardFiguresSection = {
      type: 'figures',
      key: 'sorting',
      label: 'Sortieren',
      figures: [
        { ...sawing.figures[0]!, key: 'sorted', label: 'Sortiert', value: 1300 },
        { ...sawing.figures[5]!, value: null },
      ],
    }
    const { wrapper } = await open((api) =>
      api.setDashboard({ last_sync_at: null, sections: [...fixture.sections, sorting] }),
    )

    expect(wrapper.findAll('h2').map((h2) => h2.text())).toEqual([
      'Kennzahlen: Sägen',
      'Stämme nach Mittendurchmesser',
      'Polter 2601-010145 (Krummes F)',
      'Polter 2601-010160 (Waldweg Nord)',
      'Polter 2601-010170 (Lindenallee)',
      'Sortieren',
    ])
    expect(cells(wrapper, 'Sortieren')).toEqual(['Sortiert 1.300', 'Ausbeute –'])
    expect(wrapper.text()).not.toContain('Letzter Sync')
  })

  it('opens the formula under the info button, one at a time', async () => {
    const { wrapper } = await open()
    const info = (name: string) => wrapper.get(`button[aria-label="Formel für ${name} anzeigen"]`)

    await info('Ausbeute').trigger('click')
    expect(squeezed(popup()!.textContent!)).toBe(
      'So wird Ausbeute berechnet' +
        'FormelSchnittholz ÷ Rundholz der gesägten Stämme' +
        'Eingesetzt0,46 m³ ÷ 0,84 fm' +
        'Ergebnis54,1 %' +
        'Nur gesägte Stämme gehen ein. Als gesägt zählt ein Stamm, wenn Gesägt angehakt ist, Balken vorhanden sind oder Gesägter Querschnitt erfasst ist. Stämme mit Häkchen bei Nicht sägbar zählen nicht.',
    )

    await info('Stämme gesamt').trigger('click')
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
    expect(squeezed(popup()!.textContent!)).not.toContain('Eingesetzt')

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
    expect(cells(wrapper, 'Kennzahlen: Sägen')).toHaveLength(6)
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
        '38–39 cm | 60,5 % | 1 1 Stamm | 14×14 je Stamm 2,0 | 10×14 je Stamm 2,0',
        '36–37 cm | Ausbeute – | 0 0 Stämme | 14×14 je Stamm – | 10×14 je Stamm –',
        '34–35 cm | Ausbeute – | 0 0 Stämme | 14×14 je Stamm – | 10×14 je Stamm –',
        '32–33 cm | 26,1 % | 1 1 Stamm | 14×14 je Stamm 1,0 | 10×14 je Stamm 0,0',
        '30–31 cm | Ausbeute – | 1(1) 1 Stamm (1 nicht sägbar) | 14×14 je Stamm – | 10×14 je Stamm –',
        'ohne Durchmesser | – | 11 Stamm |  | ',
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
      ])
      expect(table(wrapper).element.closest('section')!.querySelector('ul')!.textContent).toMatch(
        /Schnittholz\s*Verschnitt \(Rinde, Schwarten, Späne\)/,
      )
      expect(header(wrapper, 'Durchmesser').attributes('aria-sort')).toBe('descending')
      expect(header(wrapper, 'Ausbeute').attributes('aria-sort')).toBeUndefined()
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
        ['Ausbeute 60,5\u00a0%', '60.5'],
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
        'ohne Durchmesser',
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
        'ohne Durchmesser',
      ])
      await sortBy(wrapper, 'Stämme (nicht sägbar)')
      expect(diameters(wrapper)).toEqual([
        '36–37 cm',
        '34–35 cm',
        '38–39 cm',
        '32–33 cm',
        '30–31 cm',
        'ohne Durchmesser',
      ])

      // "–" last in both directions
      await sortBy(wrapper, 'Ausbeute')
      expect(diameters(wrapper)).toEqual([
        '38–39 cm',
        '32–33 cm',
        '36–37 cm',
        '34–35 cm',
        '30–31 cm',
        'ohne Durchmesser',
      ])
      await sortBy(wrapper, 'Ausbeute')
      expect(header(wrapper, 'Ausbeute').attributes('aria-sort')).toBe('ascending')
      expect(diameters(wrapper)).toEqual([
        '32–33 cm',
        '38–39 cm',
        '36–37 cm',
        '34–35 cm',
        '30–31 cm',
        'ohne Durchmesser',
      ])

      for (const label of ['Balken 14×14 je Stamm', 'Balken 10×14 je Stamm']) {
        await sortBy(wrapper, label)
        expect(diameters(wrapper)).toEqual([
          '38–39 cm',
          '32–33 cm',
          '36–37 cm',
          '34–35 cm',
          '30–31 cm',
          'ohne Durchmesser',
        ])
        await sortBy(wrapper, label)
        expect(diameters(wrapper)).toEqual([
          '32–33 cm',
          '38–39 cm',
          '36–37 cm',
          '34–35 cm',
          '30–31 cm',
          'ohne Durchmesser',
        ])
      }
    })

    it('has no row without diameter if every stem has one', async () => {
      const { wrapper } = await open((api) =>
        api.setDashboard({ ...fixture, sections: [{ ...byDiameter, without_diameter: 0 }] }),
      )

      expect(diameters(wrapper)).not.toContain('ohne Durchmesser')
    })
  })
})
