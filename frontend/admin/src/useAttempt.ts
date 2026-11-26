import { ref } from 'vue'

import { ApiError } from '@/api/client'
import { errorsOf } from '@/apiErrors'

/**
 * One request at a time; the outcome is said in a line next to the count of the results bar (read out too).
 * A 422 goes to `onInvalid` as "field → message" when the caller handles it, everything else becomes the line.
 */
export function useAttempt() {
  const busy = ref(false)
  const notice = ref<{ text: string; error: boolean } | null>(null)

  async function attempt(
    run: () => Promise<void>,
    onInvalid?: (errors: Record<string, string>) => void,
  ) {
    if (busy.value) return
    busy.value = true
    notice.value = null
    try {
      await run()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && onInvalid) {
        onInvalid(errorsOf(error.body))
      } else {
        notice.value = {
          text:
            error instanceof ApiError && error.status === 0
              ? 'Keine Verbindung zum Server. Bitte noch einmal versuchen.'
              : 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
          error: true,
        }
      }
    } finally {
      busy.value = false
    }
  }
  const say = (text: string) => (notice.value = { text, error: false })

  return { busy, notice, attempt, say }
}
