import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { dialog, dialogButton } from './attributesPage'
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
  await router.push('/groups')
  await flushPromises()
  return { api, router, wrapper }
}

const row = (wrapper: VueWrapper, name: string) => wrapper.get(`[data-group="${name}"]`)
const panel = (wrapper: VueWrapper) =>
  wrapper.get('section[aria-label^="Einstellungen der Gruppe"]')
const button = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((entry) => entry.text() === label)
const click = async (wrapper: VueWrapper, label: string) => {
  const target = button(wrapper, label)
  expect(target).toBeDefined()
  await target!.trigger('click')
  await flushPromises()
}
const openGroup = (wrapper: VueWrapper, name: string) =>
  row(wrapper, name).get('button').trigger('click').then(flushPromises)
const cells = (wrapper: VueWrapper, name: string) =>
  row(wrapper, name)
    .findAll('td')
    .map((cell) => cell.text())
const checkboxes = (wrapper: VueWrapper) =>
  panel(wrapper).findAll<HTMLInputElement>('[data-attribute-list] input[type=checkbox]')
const radio = (wrapper: VueWrapper, label: string) =>
  panel(wrapper)
    .findAll('label')
    .find((entry) => entry.text() === label)!
    .get<HTMLInputElement>('input')

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the table', () => {
  it('shows name, how many attributes and the members of every group, by name', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Gruppen')
    expect(wrapper.get('[aria-label=Ergebnisse] p').text()).toBe('2 Gruppen')
    expect(wrapper.findAll('th').map((head) => head.text())).toEqual([
      'Name',
      'Merkmale in der App',
      'Nutzer',
    ])
    expect(cells(wrapper, 'Sägewerk')).toEqual(['Sägewerk', '2 von 10', 'Bruno, Cem'])
    expect(cells(wrapper, 'V29')).toEqual(['V29', 'Alle', 'Ada, Chef, Dora'])
    expect(wrapper.findAll('tbody tr').map((entry) => entry.attributes('data-group'))).toEqual([
      'Sägewerk',
      'V29',
    ])
  })

  it('is in the gear menu between "Nutzer" and "Merkmale"', async () => {
    const { wrapper } = await open()

    await wrapper.get('button[aria-label="Verwaltung"]').trigger('click')
    await flushPromises()

    expect(
      [...document.querySelectorAll('[role=menuitem]')].map((item) => item.textContent!.trim()),
    ).toEqual(['Nutzer', 'Gruppen', 'Merkmale', 'Polter'])
  })

  it('shows the error state when loading fails and loads again', async () => {
    const { wrapper, api } = await open((api) => api.failGroups())
    expect(wrapper.text()).toContain('Hier ist grad der Wurm drin')
    api.failGroups(false)

    await click(wrapper, 'Erneut versuchen')

    expect(wrapper.text()).toContain('2 Gruppen')
  })
})

describe('an open group', () => {
  it('splits the table below the row; one at a time', async () => {
    const { wrapper } = await open()

    await openGroup(wrapper, 'Sägewerk')
    expect(wrapper.findAll('table')).toHaveLength(2)
    expect(panel(wrapper).attributes('aria-label')).toBe('Einstellungen der Gruppe Sägewerk')
    expect(row(wrapper, 'Sägewerk').get('button').attributes('aria-expanded')).toBe('true')

    await openGroup(wrapper, 'V29')
    expect(panel(wrapper).attributes('aria-label')).toBe('Einstellungen der Gruppe V29')
    await openGroup(wrapper, 'V29')
    expect(wrapper.find('section[aria-label^="Einstellungen der Gruppe"]').exists()).toBe(false)
  })

  it('shows "Nur ausgewählte" with the attributes in their order, type and kind below the name', async () => {
    const { wrapper, api } = await open()
    await openGroup(wrapper, 'Sägewerk')

    expect(
      radio(wrapper, 'Nur ausgewählte – neue Merkmale erst nach Freigabe').element.checked,
    ).toBe(true)
    const attributes = api.attributes.attributes
    const items = panel(wrapper).findAll('[data-attribute-list] li')
    expect(items).toHaveLength(attributes.length)
    expect(items[0].text()).toContain(attributes[0].name)
    expect(items[0].text()).toContain('Auswahl · Stamm')
    expect(panel(wrapper).get('[data-attribute-list]').text()).toContain(
      `2 von ${attributes.length} ausgewählt`,
    )
    expect(checkboxes(wrapper).filter((box) => box.element.checked)).toHaveLength(2)
  })

  it('hides the list for "Alle Merkmale" and brings the selection back', async () => {
    const { wrapper } = await open()
    await openGroup(wrapper, 'Sägewerk')
    await checkboxes(wrapper)[2].setValue(true)

    await radio(wrapper, 'Alle Merkmale, auch künftige').setValue(true)
    expect(panel(wrapper).find('[data-attribute-list]').exists()).toBe(false)
    await radio(wrapper, 'Nur ausgewählte – neue Merkmale erst nach Freigabe').setValue(true)

    expect(panel(wrapper).get('[data-attribute-list]').text()).toContain('3 von')
  })

  it('lists the members and points to the page of the users', async () => {
    const { wrapper } = await open()
    await openGroup(wrapper, 'Sägewerk')

    expect(panel(wrapper).get('ul[aria-labelledby$="-members"]').text()).toContain('Bruno')
    expect(panel(wrapper).get('a').attributes('href')).toBe('/users')
    expect(panel(wrapper).text()).toContain(
      'Wer zu welcher Gruppe gehört, legst du auf der Seite Nutzer fest.',
    )
  })

  it('saves the name and the selection; "Speichern" is active only with a change', async () => {
    const { wrapper, api } = await open()
    await openGroup(wrapper, 'Sägewerk')
    expect(button(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    await panel(wrapper).get('input').setValue(' Sägerei ')
    const unchecked = checkboxes(wrapper).find((box) => !box.element.checked)!
    await unchecked.setValue(true)
    expect(button(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()
    await panel(wrapper).get('form').trigger('submit')
    await flushPromises()

    const saved = api.groups.groups.find((group) => group.name === 'Sägerei')!
    expect(saved.attribute_ids).toHaveLength(3)
    expect(wrapper.find('section[aria-label^="Einstellungen der Gruppe"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Sägerei ist gespeichert.')
    expect(cells(wrapper, 'Sägerei')[1]).toBe('3 von 10')
  })

  it('sends no attributes when the group sees all', async () => {
    const { wrapper, api } = await open()
    await openGroup(wrapper, 'Sägewerk')

    await radio(wrapper, 'Alle Merkmale, auch künftige').setValue(true)
    await panel(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(cells(wrapper, 'Sägewerk')[1]).toBe('Alle')
    expect(api.groups.groups.find((group) => group.name === 'Sägewerk')).toMatchObject({
      sees_all_attributes: true,
      attribute_ids: [],
    })
  })

  it('shows what the server refuses at the name and stays open', async () => {
    const { wrapper } = await open((api) =>
      api.groups.reject([{ field: 'name', message: 'Diese Gruppe gibt es schon.' }]),
    )
    await openGroup(wrapper, 'Sägewerk')
    await panel(wrapper).get('input').setValue('V29')

    await panel(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(panel(wrapper).get('[role=alert]').text()).toBe('Diese Gruppe gibt es schon.')
  })

  it('cancels without saving', async () => {
    const { wrapper, api } = await open()
    await openGroup(wrapper, 'Sägewerk')
    await panel(wrapper).get('input').setValue('Sägerei')

    await click(wrapper, 'Abbrechen')

    expect(wrapper.find('section[aria-label^="Einstellungen der Gruppe"]').exists()).toBe(false)
    expect(api.calls.filter((call) => call.startsWith('PATCH'))).toEqual([])
  })
})

describe('delete', () => {
  it('is greyed out with the reason while the group has users', async () => {
    const { wrapper } = await open()
    await openGroup(wrapper, 'Sägewerk')

    const remove = button(wrapper, 'Gruppe löschen')!
    expect(remove.attributes('disabled')).toBeDefined()
    expect(remove.classes()).not.toContain('text-alert')
    expect(panel(wrapper).text()).toContain('Nur möglich, solange die Gruppe keine Nutzer hat.')
  })

  it('asks in a red dialog and deletes a group without users', async () => {
    const { wrapper, api } = await open()
    await click(wrapper, 'Gruppe hinzufügen')
    await wrapper.get('form input').setValue('Forst')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const remove = button(wrapper, 'Gruppe löschen')!
    expect(remove.attributes('disabled')).toBeUndefined()
    expect(remove.classes()).toContain('text-alert')
    expect(panel(wrapper).text()).not.toContain('Nur möglich')

    await remove.trigger('click')
    await flushPromises()
    expect(dialog()?.textContent).toContain('Forst wird gelöscht')
    expect(dialogButton('Gruppe löschen').classList).toContain('bg-alert')
    expect(api.calls).not.toContain('DELETE /api/admin/groups/new-group-1')
    dialogButton('Gruppe löschen').click()
    await flushPromises()

    expect(api.calls).toContain('DELETE /api/admin/groups/new-group-1')
    expect(wrapper.text()).toContain('2 Gruppen')
    expect(wrapper.text()).toContain('Forst ist gelöscht.')
    expect(wrapper.find('[data-group="Forst"]').exists()).toBe(false)
  })

  it('keeps the group when the question is answered with "Abbrechen"', async () => {
    const { wrapper, api } = await open()
    await click(wrapper, 'Gruppe hinzufügen')
    await wrapper.get('form input').setValue('Forst')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    await click(wrapper, 'Gruppe löschen')
    dialogButton('Abbrechen').click()
    await flushPromises()

    expect(api.calls.filter((call) => call.startsWith('DELETE'))).toEqual([])
    expect(wrapper.find('[data-group="Forst"]').exists()).toBe(true)
  })
})

describe('add', () => {
  it('opens a card with the name only', async () => {
    const { wrapper } = await open()
    expect(wrapper.find('[data-add-arrow]').exists()).toBe(false)

    await click(wrapper, 'Gruppe hinzufügen')

    expect(wrapper.find('[data-add-arrow]').exists()).toBe(true)
    expect(wrapper.findAll('form input')).toHaveLength(1)
  })

  it('creates a group that sees only the selected and none yet, then opens it', async () => {
    const { wrapper, api } = await open()
    await click(wrapper, 'Gruppe hinzufügen')

    await wrapper.get('form input').setValue(' Forst ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.groups.groups.find((group) => group.name === 'Forst')).toMatchObject({
      sees_all_attributes: false,
      attribute_ids: [],
    })
    expect(wrapper.find('[data-add-arrow]').exists()).toBe(false)
    expect(wrapper.get('[aria-label=Ergebnisse] p').text()).toBe('3 Gruppen')
    expect(panel(wrapper).attributes('aria-label')).toBe('Einstellungen der Gruppe Forst')
    expect(cells(wrapper, 'Forst')[1]).toBe('0 von 10')
    expect(
      radio(wrapper, 'Nur ausgewählte – neue Merkmale erst nach Freigabe').element.checked,
    ).toBe(true)
  })

  it('shows what the server refuses at the name and stays open', async () => {
    const { wrapper, api } = await open((api) =>
      api.groups.reject([{ field: 'name', message: 'Bitte einen Namen eingeben.' }]),
    )
    await click(wrapper, 'Gruppe hinzufügen')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('form [role=alert]').text()).toBe('Bitte einen Namen eingeben.')
    expect(api.groups.groups).toHaveLength(2)
  })

  it('closes with "Abbrechen"', async () => {
    const { wrapper } = await open()
    await click(wrapper, 'Gruppe hinzufügen')

    await click(wrapper, 'Abbrechen')

    expect(wrapper.find('[data-add-arrow]').exists()).toBe(false)
  })
})
