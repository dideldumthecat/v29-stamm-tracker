import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'
import { stemPhotoDays, stemPhotos } from './fakeSnapshot'

const CODE = 'K7QM-4XHT-9RDP'

/**
 * Signs in and opens a path. `push` is a step within the administration (so "Zurück" can step back),
 * `replace` stands for a pasted link: the page replaces the one the sign-in led to.
 */
async function open(path: string, how: 'push' | 'replace' = 'push') {
  const api = fakeApi({ [CODE]: 'admin' })
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(CODE)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await router[how](path)
  await flushPromises()
  return { api, router, wrapper }
}

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()
const section = (wrapper: VueWrapper, heading: string) =>
  wrapper.findAll('section, details').find((part) => part.text().startsWith(heading))!
const valueRow = (wrapper: VueWrapper, name: string) =>
  squeezed(
    wrapper.findAll('dt').find((dt) => dt.text() === name)!.element.parentElement!.textContent!,
  )
const photoUrl = (id: string) => `/api/photos/${id}`
const largePhoto = (wrapper: VueWrapper) =>
  section(wrapper, 'Fotos').get('button[aria-label="Foto vergrößern"]')

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  // jsdom has no modal dialogs
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('stem detail', () => {
  it('shows heading, subtitle and the cards, and asks the snapshot and the history anew', async () => {
    const { wrapper, api } = await open('/staemme/00104')

    expect(wrapper.get('h1').text()).toBe('00104')
    expect(wrapper.get('main header p').text()).toBe('STAMM')
    expect(squeezed(wrapper.get('h1 + p').text())).toBe(
      'Angelegt 29.10.2026, 11:09 von Alexander Summa Zuletzt geändert 31.10.2026, 11:50 von Alexander Barina',
    )
    expect(wrapper.findAll('h2').map((h2) => h2.text())).toEqual([
      'Fotos (2)',
      'Balken (3)',
      'Werte',
      'Notizen',
    ])
    expect(api.calls).toContain('GET /api/snapshot')
    expect(api.calls).toContain('GET /api/admin/activity?tags=104')
    expect(wrapper.text()).not.toContain('Aus Stamm')
  })

  it('lists the values with who and when, the notes with their line breaks', async () => {
    const { wrapper } = await open('/staemme/104')
    const values = section(wrapper, 'Werte')

    expect(valueRow(wrapper, 'Holzart')).toBe('HolzartStieleiche Alexander Summa · 29.10.')
    const missing = wrapper.findAll('dt').find((dt) => dt.text() === 'Lieferdatum')!.element
    expect(missing.parentElement!.querySelector('[aria-label="nicht erfasst"]')!.textContent).toBe(
      '–',
    )
    expect(values.text()).not.toContain('Notiz')
    expect(values.text()).not.toContain('Entlastungsschnitt')

    const notes = section(wrapper, 'Notizen')
    expect(notes.findAll('li').map((li) => squeezed(li.text()))).toEqual([
      'Zweite Zeile mit UmbruchAlexander Barina · 31.10.',
      'Leichter DrehwuchsAlexander Summa · 29.10.',
    ])
    expect(notes.find('[aria-label="keine Notiz"]').exists()).toBe(false)
  })

  it('lists the beams as links with their short info', async () => {
    const { wrapper } = await open('/staemme/104')
    const links = section(wrapper, 'Balken (3)').findAll('a')

    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/staemme/104-A',
      '/staemme/104-B',
      '/staemme/104-C',
    ])
    expect(links.map((link) => squeezed(link.text()))).toEqual([
      '00104-Anoch keine eigenen Angaben',
      '00104-Bnoch keine eigenen Angaben',
      '00104-CB · 105x145',
    ])
  })

  it('shows the history as a closed timeline by device time, the stem without a heading, its beams with one', async () => {
    const { wrapper } = await open('/staemme/104')
    const history = section(wrapper, 'Verlauf')

    expect(history.element.tagName).toBe('DETAILS')
    expect(history.attributes('open')).toBeUndefined()
    expect(squeezed(history.get('summary').text())).toBe('Verlauf')
    expect(history.get('summary svg').attributes('aria-hidden')).toBe('true')
    const point = history.get('li')
    expect(squeezed(point.get('time').text())).toBe('31.10.11:46')
    expect(point.get('p').text()).toBe('Alexander Barina')
    expect(point.text()).not.toContain('übertragen')
    // the stem has its rows; its beams show up only as created (their values are in their own history)
    const lists = history.findAll('dl')
    expect(lists).toHaveLength(1)
    expect(lists[0].findAll('dl > div').map((row) => squeezed(row.text()))).toEqual(['Gesägtja'])
    expect(lists[0].attributes('aria-labelledby')).toBe(point.get('p').attributes('id'))
    expect(point.findAll('p').map((p) => squeezed(p.text()))).toEqual([
      'Alexander Barina',
      'Balken 00104-A angelegt',
      'Balken 00104-B angelegt',
      'Balken 00104-C angelegt',
    ])
    expect(history.findAll('a').map((link) => link.attributes('href'))).toEqual([
      '/staemme/104-A',
      '/staemme/104-B',
      '/staemme/104-C',
    ])
  })

  it('shows "Keine Fotos." and a dash for the notes where there is nothing', async () => {
    const { wrapper } = await open('/staemme/104-B')
    expect(section(wrapper, 'Fotos (0)').text()).toContain('Keine Fotos.')
    expect(section(wrapper, 'Notizen').get('[aria-label="keine Notiz"]').text()).toBe('–')
  })
})

describe('beam detail', () => {
  it('shows inherited values as such, links to the stem and has no beam card or foreign history', async () => {
    const { wrapper } = await open('/staemme/104-c')

    expect(wrapper.get('h1').text()).toBe('00104-C')
    expect(wrapper.get('main header p').text()).toBe('BALKEN')
    expect(wrapper.get('main header a').text()).toBe('Aus Stamm 00104')
    expect(wrapper.get('main header a').attributes('href')).toBe('/staemme/104')
    expect(wrapper.findAll('h2').map((h2) => h2.text())).not.toContain('Balken (3)')
    expect(valueRow(wrapper, 'Holzart')).toBe('HolzartStieleiche vom Stamm geerbt')
    const history = section(wrapper, 'Verlauf')
    expect(squeezed(history.get('summary').text())).toBe('Verlauf')
    expect(history.findAll('dl')).toHaveLength(1)
    expect(history.text()).not.toContain('Balken 00104')
  })
})

describe('states', () => {
  it('says so when there is no such stem, beam or tag', async () => {
    const { wrapper } = await open('/staemme/999')
    expect(wrapper.get('[role=status] h2').text()).toBe('Waldesruh')
    expect(wrapper.get('[role=status]').text()).toContain('Stamm 999 gibt es nicht (mehr).')
    expect(wrapper.find('h1').exists()).toBe(false)

    await wrapper.vm.$router.push('/staemme/104-Z')
    await flushPromises()
    expect(wrapper.text()).toContain('Balken 104-Z gibt es nicht (mehr).')
    await wrapper.vm.$router.push('/staemme/abc')
    await flushPromises()
    expect(wrapper.text()).toContain('Stamm abc gibt es nicht (mehr).')
  })

  it('shows the saw blade while loading', async () => {
    const { wrapper, router } = await open('/aktivitaet')
    const answer = globalThis.fetch
    let release!: () => void
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      await new Promise<void>((resolve) => (release = resolve))
      return answer(url, init)
    })
    void router.push('/staemme/104')
    await vi.waitFor(() => expect(wrapper.find('[role=status]').exists()).toBe(true))

    expect(wrapper.get('[role=status]').text()).toContain('Moment')
    expect(wrapper.find('[role=status] svg').exists()).toBe(true)
    release()
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('00104')
  })

  it('offers to try again when the server fails', async () => {
    const { wrapper, api } = await open('/aktivitaet')
    api.failSnapshot()
    await wrapper.vm.$router.push('/staemme/104')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Stamm konnte nicht geladen werden.')

    api.failSnapshot(false)
    await wrapper.get('[role=alert] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('00104')
  })

  it('reports a failing history in its card only', async () => {
    const { wrapper, api } = await open('/aktivitaet')
    api.failActivity()
    await wrapper.vm.$router.push('/staemme/104')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('00104')
    expect(section(wrapper, 'Fotos').exists()).toBe(true)
    expect(wrapper.get('[role=alert]').text()).toContain('Der Verlauf konnte nicht geladen werden.')

    api.failActivity(false)
    await wrapper.get('[role=alert] button').trigger('click')
    await flushPromises()
    expect(squeezed(section(wrapper, 'Verlauf').get('summary').text())).toBe('Verlauf')
  })
})

describe('back', () => {
  // history.state.back does not exist in a memory history: stepping back is covered by the E2E test.
  it('links to the activity when the page was opened directly', async () => {
    const { wrapper } = await open('/staemme/104', 'replace')
    const back = wrapper.findAll('a').find((link) => link.text() === '← Zurück')!
    expect(back.attributes('href')).toBe('/aktivitaet')
  })
})

describe('link from the activity', () => {
  it('turns the tag of a detail card into a link', async () => {
    const { wrapper, router } = await open('/aktivitaet?tags=104')
    await wrapper.get('summary').trigger('click')
    const link = wrapper.findAll('article a').find((candidate) => candidate.text() === '00104-C')!
    expect(link.attributes('href')).toBe('/staemme/104-C')

    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/staemme/104-C')
    expect(wrapper.get('h1').text()).toBe('00104-C')
  })
})

describe('photos', () => {
  it('shows the first photo large and all as thumbnails, the chosen one pressed', async () => {
    const { wrapper } = await open('/staemme/104')
    const photos = section(wrapper, 'Fotos (2)')

    expect(largePhoto(wrapper).get('img').attributes('src')).toBe(photoUrl(stemPhotos[0]))
    const thumbs = photos.findAll('button[aria-pressed]')
    expect(thumbs.map((thumb) => thumb.attributes('aria-label'))).toEqual(['Foto 1', 'Foto 2'])
    expect(thumbs.map((thumb) => thumb.attributes('aria-pressed'))).toEqual(['true', 'false'])

    await thumbs[1].trigger('click')
    expect(largePhoto(wrapper).get('img').attributes('src')).toBe(photoUrl(stemPhotos[1]))
    expect(thumbs.map((thumb) => thumb.attributes('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('replaces a photo that is not uploaded yet with a placeholder that cannot be opened', async () => {
    const { wrapper } = await open('/staemme/104')
    await section(wrapper, 'Fotos').findAll('button[aria-pressed]')[1].trigger('click')
    await largePhoto(wrapper).get('img').trigger('error')

    expect(section(wrapper, 'Fotos').text()).toContain('Foto noch nicht hochgeladen')
    expect(section(wrapper, 'Fotos').find('button[aria-label="Foto vergrößern"]').exists()).toBe(
      false,
    )
  })

  it('opens the gallery at the chosen photo and names the download', async () => {
    const { wrapper } = await open('/staemme/104')
    await section(wrapper, 'Fotos').findAll('button[aria-pressed]')[1].trigger('click')
    await largePhoto(wrapper).trigger('click')

    const dialog = wrapper.get('dialog')
    expect(dialog.attributes('open')).toBeDefined()
    expect(squeezed(dialog.get('header p').text())).toBe(
      `Stamm 00104 · Foto 2 von 2 vom ${stemPhotoDays[1]}`,
    )
    expect(dialog.get('header p strong').text()).toBe('00104')
    const download = dialog.get('a[download]')
    expect(download.attributes('href')).toBe(photoUrl(stemPhotos[1]))
    expect(download.attributes('download')).toBe('00104-2.jpg')
  })

  it('moves between the photos by arrows, thumbnails and keys and starts at the fit again', async () => {
    const { wrapper } = await open('/staemme/104')
    await largePhoto(wrapper).trigger('click')
    const dialog = wrapper.get('dialog')
    const title = () => squeezed(dialog.get('header p').text())
    const previous = dialog.get('button[aria-label="Vorheriges Foto"]')
    const next = dialog.get('button[aria-label="Nächstes Foto"]')

    expect(previous.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()
    await next.trigger('click')
    // the day follows the photo shown
    expect(title()).toContain(`Foto 2 von 2 vom ${stemPhotoDays[1]}`)
    expect(next.attributes('disabled')).toBeDefined()
    await dialog.trigger('keydown', { key: 'ArrowLeft' })
    expect(title()).toContain(`Foto 1 von 2 vom ${stemPhotoDays[0]}`)
    await dialog.trigger('keydown', { key: 'ArrowLeft' })
    expect(title()).toContain('Foto 1 von 2')
    await dialog.trigger('keydown', { key: 'ArrowRight' })
    expect(title()).toContain(`Foto 2 von 2 vom ${stemPhotoDays[1]}`)
    await dialog.get('button[aria-label="Foto 1"]').trigger('click')
    expect(title()).toContain(`Foto 1 von 2 vom ${stemPhotoDays[0]}`)
    expect(dialog.get('button[aria-label="Foto 1"]').attributes('aria-pressed')).toBe('true')

    await dialog.trigger('keydown', { key: '+' })
    expect(dialog.text()).toContain('150 %')
    await dialog.trigger('keydown', { key: 'ArrowRight' })
    expect(dialog.text()).toContain('100 %')
  })

  it('zooms by buttons, keys, wheel and double click; the percentage resets to the fit', async () => {
    const { wrapper } = await open('/staemme/104')
    await largePhoto(wrapper).trigger('click')
    const dialog = wrapper.get('dialog')
    const zoom = () => dialog.get('button[aria-label^="Zoom"]').text()
    const frame = dialog.get('div.touch-none')

    expect(zoom()).toBe('100 %')
    for (const percent of ['150 %', '200 %', '300 %', '400 %', '400 %']) {
      await dialog.get('button[aria-label="Vergrößern"]').trigger('click')
      expect(zoom()).toBe(percent)
    }
    for (const percent of ['300 %', '200 %']) {
      await dialog.trigger('keydown', { key: '-' })
      expect(zoom()).toBe(percent)
    }
    await dialog.get('button[aria-label^="Zoom"]').trigger('click')
    expect(zoom()).toBe('100 %')
    await dialog.get('button[aria-label="Verkleinern"]').trigger('click')
    expect(zoom()).toBe('100 %')

    await frame.trigger('wheel', { deltaY: -100 })
    expect(zoom()).toBe('115 %')
    await frame.trigger('wheel', { deltaY: 100 })
    expect(zoom()).toBe('100 %')

    await frame.trigger('dblclick')
    expect(zoom()).toBe('200 %')
    await frame.trigger('dblclick')
    expect(zoom()).toBe('100 %')
  })

  it('closes with the button', async () => {
    const { wrapper } = await open('/staemme/104')
    await largePhoto(wrapper).trigger('click')
    await wrapper.get('dialog button[aria-label="Schließen"]').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('names the download of a beam with its tag', async () => {
    const { wrapper } = await open('/staemme/104-A')
    await largePhoto(wrapper).trigger('click')
    expect(wrapper.get('dialog a[download]').attributes('download')).toBe('00104-A-1.jpg')
    expect(squeezed(wrapper.get('dialog header p').text())).toBe(
      'Balken 00104-A · Foto 1 von 1 vom 31.10.2026, 11:46',
    )
  })
})
