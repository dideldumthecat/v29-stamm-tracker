import { vi } from 'vitest'

/** jsdom has no ResizeObserver and no scrolling into view; the pop-ups (Reka UI) and the chips need both. */
export function stubBrowser() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
}

/** The button of a filter by its id (`data-filter`). */
export const filterButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-filter="${id}"]`)!

/** The open pop-up (it lives outside the page, in a portal). */
export const popup = () => document.querySelector<HTMLElement>('[role=dialog]')

/** The chips of the results bar: the text of the button that opens them. */
export const chipTexts = () =>
  [...document.querySelectorAll('ul[aria-label="Aktive Filter"] button[data-chip]')].map((button) =>
    button.textContent!.replace(/\s+/g, ' ').trim(),
  )

/** Escape closes the open pop-up and brings the focus back to its button. */
export function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}
