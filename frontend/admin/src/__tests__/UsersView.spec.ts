import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { dialog, dialogButton } from './attributesPage'
import { fakeApi } from './fakeApi'

const ADMIN = 'K7QM-4XHT-9RDP'
const SUPERADMIN = 'S4PA-2DM1-N8QX'

async function open(code = SUPERADMIN, configure?: (api: ReturnType<typeof fakeApi>) => void) {
  const api = fakeApi({ [ADMIN]: 'admin', [SUPERADMIN]: 'superadmin' })
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(code)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  configure?.(api)
  await router.push('/users')
  await flushPromises()
  return { api, router, wrapper }
}

const row = (wrapper: VueWrapper, name: string) => wrapper.get(`[data-user="${name}"]`)
const panel = (wrapper: VueWrapper) => wrapper.get('section[aria-label^="Einstellungen von"]')
const button = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((entry) => entry.text() === label)
const click = async (wrapper: VueWrapper, label: string) => {
  const target = button(wrapper, label)
  expect(target).toBeDefined()
  await target!.trigger('click')
  await flushPromises()
}
/** Opens a user by its name in the table. */
const openUser = (wrapper: VueWrapper, name: string) =>
  row(wrapper, name).get('button').trigger('click').then(flushPromises)
const cells = (wrapper: VueWrapper, name: string) =>
  row(wrapper, name)
    .findAll('td')
    .map((cell) => cell.text())
const lastCall = (api: Awaited<ReturnType<typeof open>>['api'], method: string) =>
  api.calls.filter((call) => call.startsWith(method)).pop()

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the table', () => {
  it('shows name, role, last sync and creation of everybody, blocked users too', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Nutzer')
    expect(wrapper.text()).toContain('5 Nutzer')
    expect(wrapper.findAll('th').map((head) => head.text())).toEqual([
      'Name',
      'Rolle',
      'Letzter Sync',
      'Angelegt',
    ])
    expect(cells(wrapper, 'Ada')).toEqual(['Ada', 'Superadmin', '12.11.2026', '20.10.2026'])
    expect(cells(wrapper, 'Chef')[1]).toBe('Admin')
    expect(cells(wrapper, 'Chef')[2]).toBe('noch nicht')
    expect(cells(wrapper, 'Bruno')).toEqual(['Bruno', 'Nutzer', '13.11.2026', '22.10.2026'])
    expect(cells(wrapper, 'Cem')[0]).toBe('Cem Gesperrt')
  })

  it('opens only users the acting user may change; the superadmin has no chevron', async () => {
    const { wrapper } = await open(ADMIN)

    expect(row(wrapper, 'Bruno').find('button').exists()).toBe(true)
    expect(row(wrapper, 'Chef').find('button').exists()).toBe(false)
    expect(row(wrapper, 'Ada').find('button').exists()).toBe(false)
    expect(row(wrapper, 'Ada').find('[data-chevron]').exists()).toBe(false)
  })

  it('is in the gear menu', async () => {
    const { wrapper } = await open()

    await wrapper.get('button[aria-label="Verwaltung"]').trigger('click')
    await flushPromises()

    const labels = [...document.querySelectorAll('[role=menuitem]')].map((item) =>
      item.textContent!.trim(),
    )
    expect(labels).toEqual(['Merkmale', 'Nutzer'])
  })

  it('shows the error state when loading fails', async () => {
    const { wrapper, api } = await open(SUPERADMIN, (api) => api.failUsers())
    expect(wrapper.text()).toContain('Hier ist grad der Wurm drin')
    api.failUsers(false)

    await click(wrapper, 'Erneut versuchen')

    expect(wrapper.text()).toContain('5 Nutzer')
  })
})

describe('an open user', () => {
  it('splits the table below the row and shows the card in between; one at a time', async () => {
    const { wrapper } = await open()
    expect(wrapper.findAll('table')).toHaveLength(1)

    await openUser(wrapper, 'Bruno')

    const tables = wrapper.findAll('table')
    expect(tables).toHaveLength(2)
    expect(tables[0].findAll('tr[data-user]').map((tr) => tr.attributes('data-user'))).toEqual([
      'Ada',
      'Chef',
      'Bruno',
    ])
    expect(tables[1].findAll('tr[data-user]').map((tr) => tr.attributes('data-user'))).toEqual([
      'Cem',
      'Dora',
    ])
    expect(row(wrapper, 'Bruno').get('button').attributes('aria-expanded')).toBe('true')
    expect(panel(wrapper).attributes('aria-label')).toBe('Einstellungen von Bruno')

    await openUser(wrapper, 'Chef')

    expect(wrapper.findAll('section[aria-label^="Einstellungen von"]')).toHaveLength(1)
    expect(panel(wrapper).attributes('aria-label')).toBe('Einstellungen von Chef')
    expect(row(wrapper, 'Bruno').get('button').attributes('aria-expanded')).toBe('false')

    await openUser(wrapper, 'Chef')
    expect(wrapper.findAll('table')).toHaveLength(1)
  })

  it('throws away what was typed when another user opens', async () => {
    const { wrapper } = await open()
    await openUser(wrapper, 'Bruno')
    await panel(wrapper).get('input').setValue('Brunhild')

    await openUser(wrapper, 'Cem')
    await openUser(wrapper, 'Bruno')

    expect((panel(wrapper).get('input').element as HTMLInputElement).value).toBe('Bruno')
  })

  it('shows no code on opening: it is not stored, only a new one can be made', async () => {
    const { wrapper } = await open()

    await openUser(wrapper, 'Bruno')

    expect(panel(wrapper).find('[data-invite-code]').exists()).toBe(false)
    expect(panel(wrapper).text()).toContain('Wird aus Sicherheitsgründen nicht gespeichert.')
    expect(button(wrapper, 'Neuer Code')).toBeDefined()
    expect(wrapper.find('[data-code-warning]').exists()).toBe(false)
  })

  it('copies a new code, which is shown with the warning', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const { wrapper } = await open()
    await openUser(wrapper, 'Bruno')
    await click(wrapper, 'Neuer Code')
    dialogButton('Neuen Code erzeugen').click()
    await flushPromises()

    expect(panel(wrapper).get('[data-code-warning]').text()).toContain('nur dieses eine Mal')
    expect(panel(wrapper).find('[data-code-warning] [aria-label=Warnung]').exists()).toBe(true)
    await click(wrapper, 'Code kopieren')

    expect(writeText).toHaveBeenCalledWith('N1AA-BBBB-CCCC')
    expect(button(wrapper, 'Kopiert')).toBeDefined()
    expect(panel(wrapper).get('[role=status]').text()).toBe('Kopiert')
  })

  it('says when copying is not possible', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
    })
    const { wrapper } = await open()
    await openUser(wrapper, 'Bruno')
    await click(wrapper, 'Neuer Code')
    dialogButton('Neuen Code erzeugen').click()
    await flushPromises()

    await click(wrapper, 'Code kopieren')

    expect(panel(wrapper).get('[role=alert]').text()).toContain('von Hand')
  })

  it('drops a shown code when the user is closed, or another one opened', async () => {
    const { wrapper } = await open()
    await openUser(wrapper, 'Bruno')
    await click(wrapper, 'Neuer Code')
    dialogButton('Neuen Code erzeugen').click()
    await flushPromises()
    expect(panel(wrapper).find('[data-invite-code]').exists()).toBe(true)

    await openUser(wrapper, 'Bruno')
    await openUser(wrapper, 'Bruno')
    expect(wrapper.find('[data-invite-code]').exists()).toBe(false)

    await click(wrapper, 'Neuer Code')
    dialogButton('Neuen Code erzeugen').click()
    await flushPromises()
    await openUser(wrapper, 'Chef')
    await openUser(wrapper, 'Bruno')
    expect(wrapper.find('[data-invite-code]').exists()).toBe(false)
  })

  it('renames and closes; "Speichern" is active only with a change', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')
    expect(button(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    await panel(wrapper).get('input').setValue(' Brunhild ')
    expect(button(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()
    await panel(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(lastCall(api, 'PATCH')).toBe(`PATCH /api/admin/users/${api.users.users()[2].id}`)
    expect(api.users.users()[2].name).toBe('Brunhild')
    expect(wrapper.find('section[aria-label^="Einstellungen von"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Brunhild ist gespeichert.')
  })

  it('shows what the server refuses and stays open', async () => {
    const { wrapper } = await open(SUPERADMIN, (api) =>
      api.users.reject([{ field: 'name', message: 'Bitte einen Namen eingeben.' }]),
    )
    await openUser(wrapper, 'Bruno')
    await panel(wrapper).get('input').setValue('')

    await panel(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(panel(wrapper).get('[role=alert]').text()).toBe('Bitte einen Namen eingeben.')
  })

  it('cancels without saving', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')
    await panel(wrapper).get('input').setValue('Brunhild')

    await click(wrapper, 'Abbrechen')

    expect(wrapper.find('section[aria-label^="Einstellungen von"]').exists()).toBe(false)
    expect(api.calls.filter((call) => call.startsWith('PATCH'))).toEqual([])
  })
})

describe('the rights', () => {
  it('gives an admin the role as text and no role to choose', async () => {
    const { wrapper } = await open(ADMIN)
    await openUser(wrapper, 'Bruno')

    expect(panel(wrapper).find('select').exists()).toBe(false)
    expect(panel(wrapper).text()).toContain('Nutzer')
    await wrapper.get('button[aria-expanded=true]').trigger('click')
    await click(wrapper, 'Nutzer hinzufügen')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('gives the superadmin the role of everybody but themselves, and the same actions for administrators', async () => {
    const { wrapper } = await open()

    await openUser(wrapper, 'Chef')
    expect(panel(wrapper).get('select').element.querySelectorAll('option')).toHaveLength(2)
    expect(button(wrapper, 'Sperren')).toBeDefined()
    expect(row(wrapper, 'Ada').find('button').exists()).toBe(false)
  })

  it('changes a role with "Speichern"', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')

    await panel(wrapper).get('select').setValue('admin')
    await panel(wrapper).get('form').trigger('submit')
    await flushPromises()

    expect(api.users.users()[2].role).toBe('admin')
    expect(cells(wrapper, 'Bruno')[1]).toBe('Admin')
  })
})

describe('add', () => {
  it('opens a card with the form; the superadmin chooses the role', async () => {
    const { wrapper } = await open()
    expect(wrapper.find('[data-add-arrow]').exists()).toBe(false)

    await click(wrapper, 'Nutzer hinzufügen')

    expect(wrapper.find('[data-add-arrow]').exists()).toBe(true)
    expect(wrapper.get('form select').element.querySelectorAll('option')).toHaveLength(2)
    expect(wrapper.text()).toContain('Steht in der App oben und an jeder Erfassung.')
  })

  it('creates a user, closes and opens the new one with its code', async () => {
    const { wrapper, api } = await open()
    await click(wrapper, 'Nutzer hinzufügen')

    await wrapper.get('form input').setValue(' Eva ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.calls).toContain('POST /api/admin/users')
    expect(api.users.users().slice(-1)[0]).toMatchObject({ name: 'Eva', role: 'user' })
    expect(wrapper.find('[data-add-arrow]').exists()).toBe(false)
    expect(wrapper.text()).toContain('6 Nutzer')
    expect(panel(wrapper).attributes('aria-label')).toBe('Einstellungen von Eva')
    expect(panel(wrapper).get('[data-invite-code]').text()).toBe('N1AA-BBBB-CCCC')
    expect(panel(wrapper).find('[data-code-warning]').exists()).toBe(true)
  })

  it('creates an administrator as the superadmin', async () => {
    const { wrapper, api } = await open()
    await click(wrapper, 'Nutzer hinzufügen')

    await wrapper.get('form input').setValue('Fred')
    await wrapper.get('form select').setValue('admin')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.users.users().slice(-1)[0]).toMatchObject({ name: 'Fred', role: 'admin' })
  })

  it('shows what the server refuses at the name and stays open', async () => {
    const { wrapper, api } = await open(SUPERADMIN, (api) =>
      api.users.reject([{ field: 'name', message: 'Bitte einen Namen eingeben.' }]),
    )
    await click(wrapper, 'Nutzer hinzufügen')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('form [role=alert]').text()).toBe('Bitte einen Namen eingeben.')
    expect(api.users.users()).toHaveLength(5)
  })

  it('closes with "Abbrechen"', async () => {
    const { wrapper } = await open()
    await click(wrapper, 'Nutzer hinzufügen')

    await wrapper.get('form').findAll('button')[0].trigger('click')

    expect(wrapper.find('[data-add-arrow]').exists()).toBe(false)
  })
})

describe('new code, block and unblock', () => {
  it('renews the code after a question: the old code is gone, the new one shown', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')

    await click(wrapper, 'Neuer Code')
    expect(dialog()!.textContent).toContain('Neuen Code für Bruno erzeugen?')
    expect(dialog()!.textContent).toContain('Der bisherige Code wird sofort ungültig.')
    dialogButton('Abbrechen').click()
    await flushPromises()
    expect(api.users.renewed).toEqual([])

    await click(wrapper, 'Neuer Code')
    dialogButton('Neuen Code erzeugen').click()
    await flushPromises()

    expect(api.users.renewed).toEqual(['Bruno'])
    expect(panel(wrapper).get('[data-invite-code]').text()).toBe('N1AA-BBBB-CCCC')
    expect(panel(wrapper).find('[data-code-warning]').exists()).toBe(true)
    expect(button(wrapper, 'Neuer Code')).toBeUndefined()
    expect(wrapper.text()).toContain('Neuer Code für Bruno. Der alte gilt nicht mehr.')
  })

  it('works at once, whatever is typed in the card', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')
    await panel(wrapper).get('input').setValue('Brunhild')

    await click(wrapper, 'Neuer Code')
    dialogButton('Neuen Code erzeugen').click()
    await flushPromises()

    expect(api.users.renewed).toEqual(['Bruno'])
    expect(api.users.users()[2].name).toBe('Bruno')
    expect((panel(wrapper).get('input').element as HTMLInputElement).value).toBe('Brunhild')
  })

  it('blocks after a question and unblocks without one', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')

    await click(wrapper, 'Sperren')
    expect(dialog()!.textContent).toContain('Bruno sperren?')
    expect(dialog()!.textContent).toContain('kommt nicht mehr in App und Administration')
    dialogButton('Abbrechen').click()
    await flushPromises()
    expect(api.users.users()[2].revoked_at).toBeNull()

    await click(wrapper, 'Sperren')
    dialogButton('Sperren').click()
    await flushPromises()

    expect(api.users.users()[2].revoked_at).not.toBeNull()
    expect(cells(wrapper, 'Bruno')[0]).toBe('Bruno Gesperrt')
    expect(wrapper.text()).toContain('Bruno ist gesperrt.')
    expect(button(wrapper, 'Sperren')).toBeUndefined()
    expect(button(wrapper, 'Neuer Code')).toBeUndefined()

    await click(wrapper, 'Entsperren')

    expect(api.users.users()[2].revoked_at).toBeNull()
    expect(cells(wrapper, 'Bruno')[0]).toBe('Bruno')
    expect(wrapper.text()).toContain('Bruno ist wieder freigegeben.')
    expect(button(wrapper, 'Neuer Code')).toBeDefined()
  })

  it('says so when the server is not reachable', async () => {
    const { wrapper, api } = await open()
    await openUser(wrapper, 'Bruno')
    api.setOffline(true)

    await click(wrapper, 'Sperren')
    dialogButton('Sperren').click()
    await flushPromises()

    expect(wrapper.get('[role=alert]').text()).toContain('Keine Verbindung')
  })
})
