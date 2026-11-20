import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import type { DashboardResponse } from '@v29/shared/contract'
import dashboardFixture from '@v29/shared/fixtures/dashboard-response.json' with { type: 'json' }

import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'
import { popup, pressEscape, stubBrowser } from './popup'

const CODE = 'K7QM-4XHT-9RDP'
const fixture = dashboardFixture as DashboardResponse

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
    expect(cells(wrapper, 'Sägen')).toEqual([
      'Stämme gesamt 5',
      'Stämme bearbeitet 4',
      'Stämme nicht bearbeitet 1',
      'Rundholz bearbeitet 1,13fm',
      'Schnittholz 0,46m³',
      'Ausbeute 54,1%',
    ])
  })

  it('shows a further section without knowing it, and no sync line without events', async () => {
    const sorting = {
      key: 'sorting',
      label: 'Sortieren',
      figures: [
        { ...fixture.sections[0]!.figures[0]!, key: 'sorted', label: 'Sortiert', value: 1300 },
        { ...fixture.sections[0]!.figures[5]!, value: null },
      ],
    }
    const { wrapper } = await open((api) =>
      api.setDashboard({ last_sync_at: null, sections: [...fixture.sections, sorting] }),
    )

    expect(wrapper.findAll('h2').map((h2) => h2.text())).toEqual(['Sägen', 'Sortieren'])
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
    expect(cells(wrapper, 'Sägen')).toHaveLength(6)
  })
})
