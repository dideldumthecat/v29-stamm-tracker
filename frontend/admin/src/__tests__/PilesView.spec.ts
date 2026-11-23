import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'

const ADMIN = 'K7QM-4XHT-9RDP'

async function open(configure?: (api: ReturnType<typeof fakeApi>) => void) {
  const api = fakeApi({ [ADMIN]: 'admin' })
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(ADMIN)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  configure?.(api)
  await router.push('/pile-data')
  await flushPromises()
  return { api, router, wrapper }
}

const row = (wrapper: VueWrapper, label: string) => wrapper.get(`[data-pile="${label}"]`)
const button = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((entry) => entry.text() === label)
const click = async (wrapper: VueWrapper, label: string) => {
  const target = button(wrapper, label)
  expect(target).toBeDefined()
  await target!.trigger('click')
  await flushPromises()
}
const openPile = (wrapper: VueWrapper, label: string) =>
  row(wrapper, label).get('button').trigger('click').then(flushPromises)
const input = (wrapper: VueWrapper, label: string) => wrapper.get(`input[id$="-${label}"]`)
const value = (wrapper: VueWrapper, label: string) =>
  (input(wrapper, label).element as HTMLInputElement).value
const lastCall = (api: Awaited<ReturnType<typeof open>>['api'], method: string) =>
  api.calls.filter((call) => call.startsWith(method)).pop()
const sent = () =>
  JSON.parse(
    (
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method !== 'GET')
        .pop()![1] as RequestInit
    ).body as string,
  )

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the list', () => {
  it('shows label, volume and position of every pile and nothing of status, number or location', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Polter')
    expect(wrapper.text()).toContain(
      'Die Polter, aus denen die Stämme kommen. In der App wählt man den Polter beim Erfassen eines Stamms aus.',
    )
    expect(wrapper.text()).toContain('4 Polter')
    expect(wrapper.findAll('th').map((head) => head.text())).toEqual([
      'Polter',
      'Raummeter',
      'Lage',
    ])
    expect(
      row(wrapper, '2601-000001 (Beispielwald Nord)')
        .findAll('td')
        .map((cell) => cell.text()),
    ).toEqual(['2601-000001 (Beispielwald Nord)', '51,52 Rm', 'In OpenStreetMap öffnen'])
    const link = row(wrapper, '2601-000001 (Beispielwald Nord)').get('a')
    expect(link.attributes('href')).toBe(
      'https://www.openstreetmap.org/?mlat=51.413056&mlon=13.060556#map=16/51.413056/13.060556',
    )
    expect(link.attributes('target')).toBe('_blank')
    expect(link.find('svg').exists()).toBe(true)
    expect(
      row(wrapper, '2601-000002')
        .findAll('td')
        .map((cell) => cell.text()),
    ).toEqual(['2601-000002', '–', '–'])
    expect(row(wrapper, '2601-000003 (Lagerplatz am Weg)').findAll('td')[1].text()).toBe('8,00 Rm')
    expect(wrapper.text()).not.toContain('Inaktiv')
    expect(wrapper.text()).not.toContain('Status')
  })

  it('shows a failure with a retry', async () => {
    const { wrapper, api } = await open((fake) => fake.failPiles())
    expect(wrapper.text()).toContain('Erneut versuchen')
    api.failPiles(false)
    await click(wrapper, 'Erneut versuchen')
    expect(wrapper.text()).toContain('4 Polter')
  })
})

describe('adding', () => {
  it('opens the form under the button, reads degrees, minutes and seconds and shows the saved pile', async () => {
    const { wrapper, api } = await open()
    const add = button(wrapper, 'Polter hinzufügen')!
    expect(add.attributes('aria-expanded')).toBe('false')
    await add.trigger('click')

    expect(add.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('h2').text()).toBe('Polter hinzufügen')
    expect(wrapper.text()).not.toContain('Bezeichnung in der App')
    expect(input(wrapper, 'latitude').attributes('placeholder')).toBe(`51°24'47"`)
    expect(input(wrapper, 'longitude').attributes('placeholder')).toBe(`13°03'38"`)

    await input(wrapper, 'number').setValue('2601-010145')
    await input(wrapper, 'location').setValue('Krummes F')
    await input(wrapper, 'stackedVolume').setValue('51,52')
    await input(wrapper, 'latitude').setValue(`51°24'47"`)
    expect(wrapper.text()).toContain('= 51,413056')
    await input(wrapper, 'longitude').setValue('13° 03′ 38″')
    expect(wrapper.text()).toContain('= 13,060556')
    await click(wrapper, 'Speichern')

    expect(sent()).toEqual({
      number: '2601-010145',
      location: 'Krummes F',
      latitude: 51.413056,
      longitude: 13.060556,
      stacked_volume: 51.52,
    })
    expect(lastCall(api, 'POST')).toBe('POST /api/admin/piles')
    expect(wrapper.text()).toContain('5 Polter')
    expect(wrapper.text()).toContain('2601-010145 (Krummes F) ist angelegt.')
    expect(row(wrapper, '2601-010145 (Krummes F)').text()).toContain('51,52 Rm')
  })

  it('creates a pile with only a number, its label is the number', async () => {
    const { wrapper } = await open()
    await click(wrapper, 'Polter hinzufügen')
    await input(wrapper, 'number').setValue('02')
    await click(wrapper, 'Speichern')

    expect(sent()).toMatchObject({ number: '02', location: null })
    expect(wrapper.find('[data-pile="02"]').exists()).toBe(true)
  })

  it('shows the missing number at its field and saves nothing', async () => {
    const { wrapper } = await open()
    await click(wrapper, 'Polter hinzufügen')
    await input(wrapper, 'location').setValue('Am Bach')
    await click(wrapper, 'Speichern')

    expect(wrapper.get('[role=alert]').text()).toBe('Bitte eine Nummer eingeben.')
    expect(input(wrapper, 'number').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('4 Polter')
  })

  it('does not send what it cannot read and says so at the field', async () => {
    const { wrapper, api } = await open()
    await click(wrapper, 'Polter hinzufügen')
    await input(wrapper, 'number').setValue('03')
    await input(wrapper, 'latitude').setValue('nördlich')
    await input(wrapper, 'stackedVolume').setValue('viel')
    const before = api.calls.length
    await click(wrapper, 'Speichern')

    expect(api.calls.length).toBe(before)
    expect(wrapper.text()).toContain('Bitte als Dezimalgrad (51,4132)')
    expect(wrapper.text()).toContain('Bitte eine Zahl eingeben')
  })

  it('shows the errors of the server at their fields and keeps the form', async () => {
    const { wrapper } = await open((api) =>
      api.piles.reject([
        { field: 'number', message: 'Einen Polter mit dieser Nummer gibt es schon.' },
      ]),
    )
    await click(wrapper, 'Polter hinzufügen')
    await input(wrapper, 'number').setValue('2601-000001')
    await click(wrapper, 'Speichern')

    expect(wrapper.get('[role=alert]').text()).toBe('Einen Polter mit dieser Nummer gibt es schon.')
    expect(input(wrapper, 'number').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('4 Polter')
  })
})

describe('editing', () => {
  it('opens a pile with its values and the link to the map, enables saving only after a change', async () => {
    const { wrapper } = await open()
    await openPile(wrapper, '2601-000001 (Beispielwald Nord)')

    const card = wrapper.get(
      'section[aria-label="Polter 2601-000001 (Beispielwald Nord) bearbeiten"]',
    )
    expect(value(wrapper, 'number')).toBe('2601-000001')
    expect(value(wrapper, 'latitude')).toBe('51,413056')
    expect(card.text()).toContain('= 51,413056')
    expect(card.get('a').attributes('href')).toContain('mlat=51.413056&mlon=13.060556')
    expect(button(card as unknown as VueWrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
    expect(card.text()).not.toContain('Deaktivieren')
    expect(card.text()).not.toContain('Status')
  })

  it('shows an option without master data with an empty number, saving needs one', async () => {
    const { wrapper, api } = await open()
    await openPile(wrapper, '01')

    expect(value(wrapper, 'number')).toBe('')
    expect(wrapper.find('section[aria-label^="Polter 01"] a').exists()).toBe(false)
    await input(wrapper, 'location').setValue('Krummes F')
    await click(wrapper, 'Speichern')
    expect(wrapper.get('[role=alert]').text()).toBe('Bitte eine Nummer eingeben.')

    await input(wrapper, 'number').setValue('2601-010145')
    await click(wrapper, 'Speichern')

    expect(lastCall(api, 'PATCH')).toBe(
      'PATCH /api/admin/piles/00000000-0000-7000-8000-0000000000a4',
    )
    expect(wrapper.text()).toContain('2601-010145 (Krummes F) ist gespeichert.')
    expect(wrapper.find('[data-pile="01"]').exists()).toBe(false)
    expect(wrapper.find('[data-pile="2601-010145 (Krummes F)"]').exists()).toBe(true)
  })

  it('sends a saved position back unchanged', async () => {
    const { wrapper } = await open()
    await openPile(wrapper, '2601-000001 (Beispielwald Nord)')

    await input(wrapper, 'stackedVolume').setValue('60')
    await click(wrapper, 'Speichern')

    expect(sent()).toMatchObject({ latitude: 51.413056, longitude: 13.060556, stacked_volume: 60 })
    expect(sent()).not.toHaveProperty('active')
  })
})
