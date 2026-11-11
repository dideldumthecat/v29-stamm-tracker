import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmSheet from '../components/ConfirmSheet.vue'

const mounted: { unmount: () => void }[] = []

function mountSheet(emphasizeAction: boolean) {
  const wrapper = mount(ConfirmSheet, {
    props: { title: 'Titel', safeLabel: 'Abbrechen', actionLabel: 'Entfernen', emphasizeAction },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

// The sheet teleports to the body.
const buttons = () => [...document.body.querySelectorAll('button')]
const isFilled = (button: HTMLElement) => button.classList.contains('bg-ink')

describe('ConfirmSheet', () => {
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  })

  it('puts the filled button on top: the safe choice by default', () => {
    mountSheet(false)
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Abbrechen',
      'Entfernen',
    ])
    expect(buttons().map(isFilled)).toEqual([true, false])
  })

  it('puts the emphasized action on top, filled, with the safe choice outlined below', () => {
    mountSheet(true)
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Entfernen',
      'Abbrechen',
    ])
    expect(buttons().map(isFilled)).toEqual([true, false])
  })

  it('with choices: one filled button each, the safe choice set apart below, and no way out by the backdrop', () => {
    const wrapper = mount(ConfirmSheet, {
      props: {
        title: 'Titel',
        safeLabel: 'Abbrechen',
        choices: [
          { value: 'a', label: 'Eins' },
          { value: 'b', label: 'Zwei' },
        ],
      },
      attachTo: document.body,
    })
    mounted.push(wrapper)
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Eins',
      'Zwei',
      'Abbrechen',
    ])
    expect(buttons().map(isFilled)).toEqual([true, true, false])
    expect(document.activeElement?.textContent?.trim()).toBe('Abbrechen')
    ;(document.body.querySelector('.fixed') as HTMLElement).click()
    expect(wrapper.emitted('safe')).toBeUndefined()
    buttons()[1]!.click()
    expect(wrapper.emitted('choose')).toEqual([['b']])
  })

  it('keeps Tab inside the sheet', () => {
    mountSheet(false)
    const [first, last] = buttons()
    last!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement).toBe(first)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(last)
  })

  describe.each([
    ['with the safe choice on top', false],
    ['with the action on top', true],
  ])('%s', (_name, emphasizeAction) => {
    it('focuses the safe choice, wherever it stands', () => {
      mountSheet(emphasizeAction)
      expect(document.activeElement?.textContent?.trim()).toBe('Abbrechen')
    })

    it('answers Escape and a tap on the backdrop with the safe choice', () => {
      const wrapper = mountSheet(emphasizeAction)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      ;(document.body.querySelector('.fixed') as HTMLElement).click()
      expect(wrapper.emitted('safe')).toHaveLength(2)
      expect(wrapper.emitted('action')).toBeUndefined()
    })

    it('emits the matching event for each button', () => {
      const wrapper = mountSheet(emphasizeAction)
      const byLabel = (label: string) =>
        buttons().find((button) => button.textContent?.trim() === label)!
      byLabel('Entfernen').click()
      expect(wrapper.emitted('action')).toHaveLength(1)
      byLabel('Abbrechen').click()
      expect(wrapper.emitted('safe')).toHaveLength(1)
    })
  })
})
