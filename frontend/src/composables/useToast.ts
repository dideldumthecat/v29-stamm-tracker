import { ref } from 'vue'

export interface ToastMessage {
  // Text before and after the tag, so the tag can be rendered with faded leading zeros.
  before: string
  tagNumber?: number | string
  after?: string
  // Success unless stated otherwise; decides the icon.
  kind?: 'success' | 'warning'
}

const TOAST_DURATION_MS = 1500
// Slide-in time of the <Transition> in AppToast; the display time starts once the toast is fully out.
const TOAST_ENTER_MS = 200

// Module-level state: one toast for the whole app, shown by <AppToast /> in App.vue.
const current = ref<ToastMessage | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | undefined

export function useToast() {
  function show(message: ToastMessage) {
    clearTimeout(hideTimer)
    // Already visible: only the text changes, nothing slides in again.
    const delay = current.value ? TOAST_DURATION_MS : TOAST_ENTER_MS + TOAST_DURATION_MS
    current.value = message
    hideTimer = setTimeout(hide, delay)
  }

  function hide() {
    clearTimeout(hideTimer)
    current.value = null
  }

  return { current, show, hide }
}
