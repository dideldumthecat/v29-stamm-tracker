import { ref } from 'vue'

export interface ToastMessage {
  // Text before and after the tag, so the tag can be rendered with faded leading zeros.
  before: string
  tagNumber?: number | string
  after?: string
  // A second sentence, joined with " · " (e.g. "Stamm … gespeichert · Balken … angelegt").
  more?: Omit<ToastMessage, 'action' | 'more'>
  action?: { label: string; run: () => void }
}

const TOAST_DURATION_MS = 3000
// Longer with an action, so there is time to tap it (as in the click prototype).
const TOAST_WITH_ACTION_DURATION_MS = 5000

// Module-level state: one toast for the whole app, shown by <AppToast /> in App.vue.
const current = ref<ToastMessage | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | undefined

export function useToast() {
  function show(message: ToastMessage) {
    clearTimeout(hideTimer)
    current.value = message
    hideTimer = setTimeout(hide, message.action ? TOAST_WITH_ACTION_DURATION_MS : TOAST_DURATION_MS)
  }

  function hide() {
    clearTimeout(hideTimer)
    current.value = null
  }

  return { current, show, hide }
}
