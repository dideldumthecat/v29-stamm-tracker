import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'

/** What the tests of the page "Merkmale" share: opening it signed in, and finding things on it. */
export const CODE = 'K7QM-4XHT-9RDP'

export async function open(
  path = '/attributes',
  configure?: (api: ReturnType<typeof fakeApi>) => void,
) {
  const api = fakeApi({ [CODE]: 'admin' })
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(CODE)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  configure?.(api)
  await router.push(path)
  await flushPromises()
  return { api, router, wrapper }
}
export type Opened = Awaited<ReturnType<typeof open>>

export const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()
export const attributeOf = (api: Opened['api'], name: string) =>
  api.attributes.attributes.find((attribute) => attribute.name === name)!
/** The fields of the preview by their button label, e.g. "Holzart" or "Gesägt (Systemmerkmal)". */
export const previewButtons = (wrapper: VueWrapper) =>
  wrapper
    .findAll('[aria-label="Vorschau"] button')
    .filter((button) => !button.attributes('aria-label')!.endsWith('verschieben'))
/** The handles of the preview, by their label "Holzart verschieben". */
export const handles = (wrapper: VueWrapper) =>
  wrapper
    .findAll('[aria-label="Vorschau"] button')
    .filter((button) => button.attributes('aria-label')!.endsWith('verschieben'))
export const handle = (wrapper: VueWrapper, name: string) =>
  handles(wrapper).find((button) => button.attributes('aria-label') === `${name} verschieben`)!
export const previewNames = (wrapper: VueWrapper) =>
  previewButtons(wrapper).map((button) => button.attributes('aria-label'))
export const field = (wrapper: VueWrapper, name: string) =>
  previewButtons(wrapper).find((button) => button.attributes('aria-label')!.startsWith(name))!
export const settings = (wrapper: VueWrapper) =>
  wrapper.find('section[aria-labelledby$="-heading"]')
export const buttonWith = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((button) => squeezed(button.text()) === text)
export const countText = (wrapper: VueWrapper) =>
  wrapper
    .findAll('p')
    .find((p) => /^\d+ Merkmal/.test(p.text()))
    ?.text()
export const dialog = () => document.querySelector<HTMLElement>('[role=alertdialog]')
export const dialogButton = (text: string) =>
  [...dialog()!.querySelectorAll('button')].find((button) => button.textContent!.trim() === text)!
