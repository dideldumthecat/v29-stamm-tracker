import { computed, toValue, useId, type MaybeRefOrGetter } from 'vue'

/**
 * The one place that defines how a field shows an error (rule in frontend/app/CLAUDE.md): red border, `aria-invalid` and
 * `aria-describedby` on the input, the message itself via `<FieldError :id="errorId" :message="…" />`.
 * Use `errorBorder` instead of a fixed border colour and bind `errorAttrs` on the input.
 */
export function useFieldError(error: MaybeRefOrGetter<string | null | undefined>) {
  const errorId = useId()
  const hasError = computed(() => !!toValue(error))
  return {
    errorId,
    errorBorder: computed(() => (hasError.value ? 'border-alert' : 'border-ink')),
    errorAttrs: computed(() =>
      hasError.value ? { 'aria-invalid': true, 'aria-describedby': errorId } : {},
    ),
  }
}
