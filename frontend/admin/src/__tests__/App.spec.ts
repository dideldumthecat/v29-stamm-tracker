import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { request } from '@/api/client'
import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'

const ADMIN = 'K7QM-4XHT-9RDP'
const USER = 'W3ZV-8NBC-2F6G'
const CODES = { [ADMIN]: 'admin', [USER]: 'user' }

async function start(path: string) {
  const router = createAdminRouter(createMemoryHistory())
  await router.push(path)
  const wrapper = mount(App, { global: { plugins: [router] } })
  await flushPromises()
  return { router, wrapper }
}

async function signIn(wrapper: Awaited<ReturnType<typeof start>>['wrapper'], code: string) {
  await wrapper.get('input').setValue(code)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  user.value = null
})
afterEach(() => vi.unstubAllGlobals())

describe('router guard', () => {
  it('sends a visitor without sign-in to the login and back after signing in', async () => {
    const api = fakeApi(CODES)
    const { router, wrapper } = await start('/x?y=1')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/x?y=1')

    await signIn(wrapper, ADMIN)

    expect(router.currentRoute.value.fullPath).toBe('/x?y=1')
    expect(wrapper.get('h1').text()).toBe('V29 Stamm-Tracker – Administration')
    expect(api.calls).toEqual(['GET /api/admin/me', 'POST /api/session', 'GET /api/admin/me'])
  })

  it('asks the server only once per page load', async () => {
    const api = fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)
    await router.push('/a')
    await router.push('/b')

    expect(api.calls.filter((call) => call === 'GET /api/admin/me')).toHaveLength(1)
  })

  it('ignores a redirect to another site', async () => {
    fakeApi(CODES)
    const { router, wrapper } = await start('/login?redirect=//evil.example')
    await signIn(wrapper, ADMIN)

    expect(router.currentRoute.value.fullPath).toBe('/aktivitaet')
  })

  it('opens the activity for "/" and shows the placeholder for an unknown path', async () => {
    fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('activity')

    await router.push('/gibt-es-nicht')
    expect(wrapper.get('h1').text()).toBe('V29 Stamm-Tracker – Administration')
  })

  it('goes to the login when a later request is refused', async () => {
    const api = fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)
    await router.push('/page')

    api.expireSession()
    await expect(request('GET', 'admin/me')).rejects.toMatchObject({ status: 401 })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/page')
    expect(user.value).toBeNull()
  })
})

describe('login', () => {
  it.each([
    ['AAAA-AAAA-AAAA', 'Code unbekannt oder gesperrt.'],
    [USER, 'Dieser Code hat keinen Zugang zur Administration.'],
  ])('shows why the code %s does not work and stays on the login', async (code, message) => {
    fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, code)

    expect(wrapper.get('[role=alert]').text()).toBe(message)
    expect(router.currentRoute.value.name).toBe('login')
    expect(wrapper.find('header').exists()).toBe(false)
  })

  it('reports a missing connection', async () => {
    fakeApi(CODES, { offline: true })
    const { wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)

    expect(wrapper.get('[role=alert]').text()).toBe('Keine Verbindung zum Server.')
  })

  it.each([
    ['typed in lowercase', 'k7qm4xht9rdp'],
    ['pasted with spaces and hyphens', ' k7qm 4xht-9rdp '],
  ])('formats the code as it comes in: %s', async (_, text) => {
    fakeApi(CODES)
    const { wrapper } = await start('/login')
    await wrapper.get('input').setValue(text)

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(ADMIN)
  })

  it('takes the hyphen away together with the next character (backspace)', async () => {
    fakeApi(CODES)
    const { wrapper } = await start('/login')
    await wrapper.get('input').setValue('K7QM4')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('K7QM-4')
    await wrapper.get('input').setValue('K7QM-')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('K7QM')
  })

  it('does not ask the server about an incomplete code', async () => {
    const api = fakeApi(CODES)
    const { wrapper } = await start('/login')
    const before = api.calls.length
    await signIn(wrapper, 'K7QM-4XHT')

    expect(wrapper.get('[role=alert]').text()).toBe('Kein Einladungscode erkannt')
    expect(api.calls).toHaveLength(before)
  })

  it('clears the field with the × button', async () => {
    fakeApi(CODES)
    const { wrapper } = await start('/login')
    await wrapper.get('input').setValue('ABC')
    await wrapper.get('button[aria-label="Code löschen"]').trigger('click')

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })
})

describe('sign out', () => {
  it('shows the name, signs out and sends every page back to the login', async () => {
    const api = fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)
    expect(wrapper.get('header').text()).toContain('Ada')

    await wrapper.get('button[aria-label="Abmelden"]').trigger('click')
    await flushPromises()

    expect(api.calls).toContain('DELETE /api/session')
    expect(router.currentRoute.value.name).toBe('login')
    expect(wrapper.find('header').exists()).toBe(false)

    await router.push('/x')
    expect(router.currentRoute.value.name).toBe('login')
  })
})

describe('frame', () => {
  it('marks the page of the current route in the navigation', async () => {
    fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)
    await router.push('/')

    expect(wrapper.findAll('nav a').map((link) => link.text())).toEqual(['Stämme', 'Aktivität'])
    const current = wrapper.get('nav [aria-current=page]')
    expect(current.text()).toBe('Aktivität')

    await router.push('/x')
    expect(wrapper.find('nav [aria-current]').exists()).toBe(false)
  })

  it('keeps the sign-out button with the name "Abmelden" and shows an error if it fails', async () => {
    const api = fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    await signIn(wrapper, ADMIN)
    api.failSignOut()

    const button = wrapper.get('button[aria-label="Abmelden"]')
    expect(button.attributes('title')).toBe('Abmelden')
    await button.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role=alert]').text()).toBe('Abmelden fehlgeschlagen.')
    expect(router.currentRoute.value.name).not.toBe('login')
  })

  it.each(['/login', '/'])('shows the credit with the link below %s', async (path) => {
    fakeApi(CODES)
    const { router, wrapper } = await start('/login')
    if (path === '/') {
      await signIn(wrapper, ADMIN)
      await router.push(path)
    }

    const link = wrapper.get('footer a[href="https://alexandersumma.de"]')
    expect(link.text()).toBe('Alexander Summa')
    expect(wrapper.get('footer').text()).toContain('love')
  })
})
