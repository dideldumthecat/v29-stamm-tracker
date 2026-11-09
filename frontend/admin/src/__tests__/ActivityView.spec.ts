import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { formatTime } from '@/activity'
import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { activityFixture } from './fakeActivity'
import { fakeApi } from './fakeApi'

const CODE = 'K7QM-4XHT-9RDP'

async function open(path = '/aktivitaet', options: Parameters<typeof fakeApi>[1] = {}) {
  const api = fakeApi({ [CODE]: 'admin' }, options)
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  // attached to the document, so that focus can be checked
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(CODE)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await router.push(path)
  await flushPromises()
  return { api, router, wrapper }
}

type Wrapper = Awaited<ReturnType<typeof open>>['wrapper']

/** The element of the entry that arrived at this German time on 31 October (the times are unique there). */
const entryAt = (wrapper: Wrapper, time: string) =>
  wrapper
    .findAll('section')[1]
    .findAll('time')
    .find((t) => t.text() === time)!
    .element.closest('article')!
const tagsField = (wrapper: Wrapper) => wrapper.get<HTMLInputElement>('#activity-tags')
// setValue also sends "change", which applies at once: this is the Enter / leaving-the-field case
const setTags = async (wrapper: Wrapper, tags: string) => {
  await tagsField(wrapper).setValue(tags)
  await flushPromises()
}
// typing only: sends "input" like a keystroke, nothing else
const typeTags = (wrapper: Wrapper, text: string) => {
  tagsField(wrapper).element.value = text
  return tagsField(wrapper).trigger('input')
}
const resetLink = (wrapper: Wrapper) =>
  wrapper
    .get('form')
    .findAll('button')
    .find((b) => b.text() === 'Filter zurücksetzen')!
const squeezed = (element: Element) => element.textContent!.replace(/\s+/g, ' ')

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
})
afterEach(() => vi.unstubAllGlobals())

describe('activity page', () => {
  it('shows the title, only the number of entries and the days with their dates', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Aktivität')
    expect(wrapper.get('h1 + p').text().replace(/\s+/g, ' ')).toBe(
      'Wer hat wann was erfasst? Die Uhrzeit links ist der Eingang am Server (nach einem Sync), die Zeiten in den Details sind die Uhrzeit am Handy zum Zeitpunkt der Erfassung.',
    )
    expect(wrapper.text()).not.toContain('neueste zuerst')
    // the number stands alone, without a legend behind it
    expect(wrapper.get('main > p.text-lg').text()).toBe('6 Einträge')
    expect(wrapper.text()).not.toContain('Personen')
    const days = wrapper.findAll('section')
    expect(days.map((day) => day.get('h2').text())).toEqual(['Di, 03.11.2026', 'Sa, 31.10.2026'])
    expect(days[1].get('h2').element.parentElement).toBe(days[1].element)
    expect(days[1].text()).not.toContain('31 Ereignisse')
  })

  it('writes an entry as time, person with counts behind it, and bullet points without tags', async () => {
    const { wrapper } = await open()
    const entry = entryAt(wrapper, '11:48')

    expect(entry.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Alexander Barina 11 Ereignisse',
    )
    expect([...entry.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      '3 Balken angelegt',
      'Gesägt – 1 Stamm',
      'Notiz – 1 Balken',
      '3 Fotos',
    ])
    expect(squeezed(entryAt(wrapper, '17:09'))).toContain('2 Ereignisse')
    expect(wrapper.findAll('button').find((b) => b.text() === 'Details')).toBeUndefined()
  })

  it('shows numbers with comma and unit and months in words', async () => {
    const { wrapper } = await open()
    const details = wrapper.findAll('section')[0].get('details')

    const cells = details
      .findAll('dl > div')
      .map((row) => [row.get('dt').text(), row.get('dd').text()])
    expect(cells).toEqual([
      ['Länge', '4,10 m'],
      ['Stammmittendurchmesser groß', '32,5 cm'],
      ['Fälldatum', 'Oktober 2026'],
    ])
  })

  it('keeps the single stems and beams in a closed <details>, tags padded with grey zeros', async () => {
    const { wrapper } = await open()
    const details = entryAt(wrapper, '11:48').querySelector('details')!
    expect(details.open).toBe(false)
    // both texts are in the DOM, CSS shows the one that fits the state (the e2e test checks which)
    expect(details.querySelector('summary')!.textContent).toBe('Details anzeigenDetails ausblenden')
    expect(details.querySelector('summary')!.className).toContain('list-none')
    expect(details.querySelector('summary svg')!.getAttribute('aria-hidden')).toBe('true')

    details.open = true
    // one list of rows per stem or beam; tag (left) and time (right) form the header of its card, which names the list
    const items = [...details.querySelectorAll('dl')]
    const tagOf = (table: Element) => table.previousElementSibling!.querySelector('span')!
    expect(items.map((table) => tagOf(table).textContent)).toEqual([
      '00104-C',
      '00104-B',
      '00104-A',
      '00104',
    ])
    const tag = tagOf(items[3]).querySelector('span span span')!
    expect(tag.textContent).toBe('00')
    expect(tag.className).toContain('opacity-40')
    expect(tagOf(items[3]).className).toContain('font-semibold')

    const last = items[0]
    // name and value apart; the tag of a new beam is part of its creation and not a row of its own
    expect(
      [...last.querySelectorAll('dl > div')].map((row) => [
        row.querySelector('dt')!.textContent!.trim(),
        row.querySelector('dd')!.textContent,
      ]),
    ).toEqual([
      ['Balken', 'angelegt'],
      ['Notiz', '105x145'],
      ['Fotos', '1 hinzugefügt'],
    ])
    // exactly one time per stem or beam: the device time of its first change, in German time
    const firstChanges = entryAt(wrapper, '11:48').querySelectorAll('dl')
    expect(
      [...firstChanges].map((table) => table.parentElement!.querySelectorAll('time').length),
    ).toEqual([1, 1, 1, 1])
    // newest first
    const entry = activityFixture.entries.find((e) => e.items.length === 4)!
    const newestFirst = [...entry.items].reverse()
    expect(
      [...firstChanges].map((table) =>
        table.parentElement!.querySelector('time')!.getAttribute('datetime'),
      ),
    ).toEqual(newestFirst.map((i) => i.changes[0].recorded_at))
    expect(
      [...firstChanges].map((table) => table.parentElement!.querySelector('time')!.textContent),
    ).toEqual(newestFirst.map((i) => formatTime(i.changes[0].recorded_at)))
    // the card has the radius of the other cards
    expect(details.querySelector('dl')!.parentElement!.className).toContain('card')
    const header = details.querySelector('dl')!.previousElementSibling!
    expect(header.className).toContain('border-soft')
    expect(details.querySelector('dl')!.getAttribute('aria-labelledby')).toBe(header.id)
    // the rows are separated by a line, but none after the last one
    expect(details.querySelector('dl > div')!.className).toContain('not-last:border-b')
    expect(details.querySelector('summary')!.className).toContain('text-base')
    // values are not bold
    expect(last.querySelectorAll('dd.font-semibold, dd.font-bold')).toHaveLength(0)
  })

  it('puts the filters in the URL and asks the server with them', async () => {
    const { api, router, wrapper } = await open()
    const labelled = (text: string) =>
      wrapper.findAll('label').find((l) => l.text().startsWith(text))!

    // One change at a time, like a person: each one is a navigation that finishes before the next
    await labelled('Von').get('input').setValue('2026-10-31')
    await flushPromises()
    await labelled('Bis').get('input').setValue('2026-11-03')
    await flushPromises()
    await labelled('Person').get('select').setValue(activityFixture.users[2].id)
    await flushPromises()
    await tagsField(wrapper).setValue(' 128 ')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({
      from: '2026-10-31',
      to: '2026-11-03',
      user: activityFixture.users[2].id,
      tags: '128',
    })
    const last = api.calls[api.calls.length - 1]
    expect(last).toContain('from=2026-10-31')
    expect(last).toContain('tags=128')
    expect(wrapper.text()).toContain('1 Eintrag')
  })

  it('reads the filter from the URL, also after a reload', async () => {
    const { api, wrapper } = await open('/aktivitaet?tags=1998')

    expect(api.calls[api.calls.length - 1]).toContain('tags=1998')
    expect(
      (
        wrapper.findAll('input').find((i) => i.attributes('type') === 'text')!
          .element as HTMLInputElement
      ).value,
    ).toBe('1998')
    expect(wrapper.text()).toContain('1 Eintrag')
  })

  it('ignores filters an old link still carries and drops them with the next change', async () => {
    const { api, router, wrapper } = await open('/aktivitaet?source=console&tags=1998')

    expect(api.calls[api.calls.length - 1]).not.toContain('source')
    expect(wrapper.text()).toContain('1 Eintrag')

    await wrapper
      .findAll('label')
      .find((l) => l.text().startsWith('Von'))!
      .get('input')
      .setValue('2026-10-31')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tags: '1998', from: '2026-10-31' })
  })

  it('goes back to the previous filter with the back button', async () => {
    const { router, wrapper } = await open()
    await setTags(wrapper, '1998')
    expect(wrapper.text()).toContain('1 Eintrag')

    router.back()
    await flushPromises()
    expect(wrapper.text()).toContain('6 Einträge')
  })

  it('appends the next page with "Ältere laden" until there is none', async () => {
    const { wrapper } = await open('/aktivitaet', { pageSize: 4 })
    const button = () => wrapper.findAll('button').find((b) => b.text() === 'Ältere laden')
    expect(wrapper.findAll('section article > div > time')).toHaveLength(4)

    await button()!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('section article > div > time')).toHaveLength(6)
    expect(wrapper.findAll('section')).toHaveLength(2)
    expect(button()).toBeUndefined()
  })

  describe('without entries', () => {
    // the one on the card, not the link in the filter bar
    const resetButton = (wrapper: Wrapper) =>
      wrapper
        .get('[role=status]')
        .findAll('button')
        .find((b) => b.text() === 'Filter zurücksetzen')

    it('shows "Waldesruh" and, with a filter, the button that clears it', async () => {
      const { api, router, wrapper } = await open('/aktivitaet?tags=999&from=2026-10-31')
      expect(wrapper.get('h2').text()).toBe('Waldesruh')
      expect(wrapper.text()).toContain('Für diese Auswahl gibt es keine Einträge.')
      expect(wrapper.find('svg[aria-hidden=true]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('0 Einträge')
      expect(wrapper.text()).not.toContain('Ältere laden')

      await resetButton(wrapper)!.trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
      expect(api.calls[api.calls.length - 1]).not.toContain('tags=')
      expect(wrapper.text()).toContain('6 Einträge')
      expect(wrapper.text()).not.toContain('Waldesruh')
    })

    it('offers no button without a filter', async () => {
      // a page size of 0 makes the fake answer "no entries" without any filter
      const { wrapper } = await open('/aktivitaet', { pageSize: 0 })
      expect(wrapper.text()).toContain('Waldesruh')
      expect(resetButton(wrapper)).toBeUndefined()
    })
  })

  it('reports an error and tries again', async () => {
    const { api, wrapper } = await open('/aktivitaet?from=2026-10-31')
    api.failActivity()
    await setTags(wrapper, '1998')
    expect(wrapper.get('[role=alert]').text()).toContain(
      'Die Aktivität konnte nicht geladen werden.',
    )

    api.failActivity(false)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Erneut versuchen')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.text()).toContain('1 Eintrag')
  })

  it('shows "Waldesruh" for a filter the server cannot read, with the button that clears it', async () => {
    const { api, router, wrapper } = await open('/aktivitaet?tags=bad')

    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.get('h2').text()).toBe('Waldesruh')
    expect(wrapper.text()).toContain(
      'Die Filter verstehen wir nicht. Kennung zum Beispiel 104 oder 100-120.',
    )
    expect(wrapper.text()).not.toContain('Einträge')
    expect(wrapper.text()).not.toContain('Ältere laden')

    await resetLink(wrapper).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(api.calls[api.calls.length - 1]).not.toContain('tags=')
    expect(wrapper.text()).toContain('6 Einträge')
  })

  describe('the link "Filter zurücksetzen" in the filter bar', () => {
    it('is always shown, but disabled without a filter in the URL', async () => {
      const { wrapper } = await open()
      expect(resetLink(wrapper).attributes('disabled')).toBeDefined()

      for (const filter of ['from=2026-10-31', 'to=2026-11-03', 'user=abc', 'tags=128']) {
        const { wrapper: filtered } = await open(`/aktivitaet?${filter}`)
        expect(resetLink(filtered).attributes('disabled')).toBeUndefined()
        expect(resetLink(filtered).attributes('type')).toBe('button')
      }
    })

    it('clears all filters, loads again, empties the Kennung field and focuses "Von"', async () => {
      const { api, router, wrapper } = await open('/aktivitaet?from=2026-10-31&tags=128')
      expect(tagsField(wrapper).element.value).toBe('128')

      await resetLink(wrapper).trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
      expect(api.calls[api.calls.length - 1]).not.toMatch(/from=|tags=/)
      expect(wrapper.text()).toContain('6 Einträge')
      expect(tagsField(wrapper).element.value).toBe('')
      expect(document.activeElement).toBe(wrapper.get('input[type=date]').element)
    })

    it('drops a running search of the Kennung field', async () => {
      vi.useFakeTimers()
      try {
        const { router, wrapper } = await open('/aktivitaet?from=2026-10-31')
        await typeTags(wrapper, '128')
        await resetLink(wrapper).trigger('click')
        await vi.advanceTimersByTimeAsync(1000)
        expect(router.currentRoute.value.query).toEqual({})
        expect(tagsField(wrapper).element.value).toBe('')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('turns exactly the filters that are set white with a black border', async () => {
    const { wrapper } = await open()
    const fields = () => wrapper.findAll('form input, form select')
    expect(fields()).toHaveLength(4)
    for (const field of fields()) {
      expect(field.classes()).toEqual(expect.arrayContaining(['border-dim', 'bg-transparent']))
    }
    await setTags(wrapper, '128')
    const [from, to, person, tags] = fields()
    for (const field of [from, to, person]) expect(field.classes()).toContain('border-dim')
    expect(tags.classes()).toEqual(expect.arrayContaining(['border-ink', 'bg-paper']))
    expect(tags.classes()).not.toContain('bg-transparent')
  })

  it('shows a rotating saw blade on a white card while loading, the filters stay', async () => {
    const { wrapper } = await open()
    // hold the answer back
    let release!: (value: Response) => void
    const held = new Promise<Response>((resolve) => (release = resolve))
    vi.mocked(fetch).mockImplementationOnce(() => held)

    await setTags(wrapper, '128')
    const card = wrapper.get('[role=status]')
    expect(card.get('h2').text()).toBe('Moment')
    expect(card.get('p').text()).toBe('Ergebnis wird zurechtgesägt')
    expect(card.classes()).toEqual(expect.arrayContaining(['card', 'min-h-72']))
    expect(card.get('h2').classes()).toEqual(expect.arrayContaining(['text-display', 'font-bold']))
    expect(card.get('p').classes()).toEqual(expect.arrayContaining(['text-mute', 'max-w-[32ch]']))
    expect(card.get('svg').attributes('aria-hidden')).toBe('true')
    expect(card.get('g').classes()).toContain('spinning')
    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(true)

    release(new Response(JSON.stringify(activityFixture)))
    await flushPromises()
    expect(wrapper.find('[role=status]').exists()).toBe(false)
  })

  it('reports no connection as an error, not as "Waldesruh"', async () => {
    const { wrapper } = await open()
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await setTags(wrapper, '128')
    expect(wrapper.get('[role=alert]').text()).toContain('Keine Verbindung zum Server.')
    expect(wrapper.text()).not.toContain('Waldesruh')
  })

  describe('searching for a tag while typing', () => {
    afterEach(() => vi.useRealTimers())
    const clearButton = (wrapper: Wrapper) => wrapper.find('button[aria-label="Kennung leeren"]')
    const wait = async (ms: number) => {
      vi.advanceTimersByTime(ms)
      await flushPromises()
    }
    // only the timers of the field are faked: flushPromises needs the real setImmediate
    const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    it('applies a complete entry 500 ms after the last keystroke, without Enter', async () => {
      const { api, router, wrapper } = await open()
      fake()

      await typeTags(wrapper, '104')
      await wait(499)
      expect(router.currentRoute.value.query).toEqual({})
      await wait(1)

      expect(router.currentRoute.value.query).toEqual({ tags: '104' })
      expect(api.calls[api.calls.length - 1]).toContain('tags=104')
    })

    it('sends only what is complete, and only the last one of several keystrokes', async () => {
      const { api, router, wrapper } = await open()
      fake()
      const before = api.calls.length

      await typeTags(wrapper, '100-')
      await wait(500)
      await typeTags(wrapper, '100-13')
      await wait(500)
      expect(api.calls).toHaveLength(before)
      await typeTags(wrapper, '100-130')
      await wait(300)
      await typeTags(wrapper, ' 100-130 ')
      await wait(500)

      expect(api.calls.slice(before)).toHaveLength(1)
      expect(router.currentRoute.value.query).toEqual({ tags: '100-130' })
      expect(wrapper.text()).not.toContain('Waldesruh')
      // the field keeps what was typed, blanks included
      expect(tagsField(wrapper).element.value).toBe(' 100-130 ')
    })

    it('applies an unreadable entry on Enter and on leaving the field, as "Waldesruh", and cancels the pause', async () => {
      const { api, router, wrapper } = await open()
      fake()
      const before = api.calls.length

      await typeTags(wrapper, '100-')
      await wait(500)
      await tagsField(wrapper).trigger('keydown.enter')
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({ tags: '100-' })
      expect(wrapper.get('h2').text()).toBe('Waldesruh')
      expect(wrapper.text()).toContain('Die Filter verstehen wir nicht.')

      // a complete entry waiting for its pause is applied by "change" at once, and the pause then does nothing more
      await typeTags(wrapper, '104')
      await tagsField(wrapper).trigger('change')
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({ tags: '104' })
      const calls = api.calls.length
      await wait(1000)
      expect(api.calls).toHaveLength(calls)
      expect(calls).toBeGreaterThan(before)
    })

    it('removes the filter at once when the field is emptied', async () => {
      const { router, wrapper } = await open('/aktivitaet?tags=104')
      fake()

      await typeTags(wrapper, '')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
      expect(wrapper.text()).toContain('6 Einträge')
    })

    it('writes at most one history entry for a search with several pauses', async () => {
      const { router, wrapper } = await open()
      fake()
      const push = vi.spyOn(router, 'push')
      const replace = vi.spyOn(router, 'replace')

      for (const text of ['1', '10', '104', '1045', '104']) {
        await typeTags(wrapper, text)
        await wait(500)
      }

      expect(push).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledTimes(4)
      expect(router.currentRoute.value.query).toEqual({ tags: '104' })
      router.back()
      await flushPromises()
      expect(router.currentRoute.value.query).toEqual({})
    })

    it('does not touch the field while loading, and follows the URL when it changes from outside', async () => {
      const { router, wrapper } = await open()
      fake()
      const field = tagsField(wrapper).element

      await typeTags(wrapper, '104')
      await wait(500)
      expect(tagsField(wrapper).element).toBe(field)
      // typing on while the answer is outstanding keeps the text
      await typeTags(wrapper, '1045')
      expect(field.value).toBe('1045')

      await router.push({ query: { tags: '7' } })
      await flushPromises()
      expect(field.value).toBe('7')
      router.back()
      await flushPromises()
      expect(field.value).toBe('104')
    })

    it('shows the clear button only with text, and it empties field and filter and focuses the field', async () => {
      const { router, wrapper } = await open('/aktivitaet?tags=104')
      expect(clearButton(wrapper).exists()).toBe(true)
      const button = clearButton(wrapper)
      expect(button.attributes('type')).toBe('button')
      expect(button.get('svg').attributes('aria-hidden')).toBe('true')
      expect(button.classes()).toEqual(expect.arrayContaining(['size-11', 'text-ink']))

      await typeTags(wrapper, '')
      expect(clearButton(wrapper).exists()).toBe(false)
      await typeTags(wrapper, '100-')
      await clearButton(wrapper).trigger('click')
      await flushPromises()

      expect(tagsField(wrapper).element.value).toBe('')
      expect(router.currentRoute.value.query).toEqual({})
      expect(clearButton(wrapper).exists()).toBe(false)
      expect(document.activeElement).toBe(tagsField(wrapper).element)
    })

    it('cancels a waiting pause when the clear button is used', async () => {
      const { api, router, wrapper } = await open()
      fake()

      await typeTags(wrapper, '104')
      await clearButton(wrapper).trigger('click')
      await flushPromises()
      const calls = api.calls.length
      await wait(1000)

      expect(api.calls).toHaveLength(calls)
      expect(router.currentRoute.value.query).toEqual({})
    })
  })

  it('marks "Aktivität" in the navigation', async () => {
    const { wrapper } = await open()
    expect(wrapper.get('nav [aria-current=page]').text()).toBe('Aktivität')
  })
})
