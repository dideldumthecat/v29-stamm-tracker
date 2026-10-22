import { ref } from 'vue'

export interface ToastMessage {
  // Text before and after the tag, so the tag can be rendered with faded leading zeros.
  before: string
  tagNumber?: number
  after?: string
}

const TOAST_DURATION_MS = 3000

// Module-level state: one toast for the whole app, shown by <AppToast /> in App.vue.
const current = ref<ToastMessage | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | undefined

export function useToast() {
  function show(message: ToastMessage) {
    clearTimeout(hideTimer)
    current.value = message
    hideTimer = setTimeout(hide, TOAST_DURATION_MS)
  }

  function hide() {
    clearTimeout(hideTimer)
    current.value = null
  }

  return { current, show, hide }
}
