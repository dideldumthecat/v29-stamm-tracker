<script setup lang="ts">
import { TAG_DIGITS } from '@v29/shared/tag'
import { TAG_MIN_NUMBER, TAG_MAX_NUMBER } from '@/config/constants'
import { computed } from 'vue'
import FieldError from '@/components/FieldError.vue'
import { useFieldError } from '@/composables/useFieldError'

const props = defineProps<{
  tagInput: string
  hasError: boolean
}>()

const message = computed(() =>
  props.hasError
    ? `Ungültige Nummer. Bitte gib eine Zahl zwischen ${TAG_MIN_NUMBER} und ${TAG_MAX_NUMBER} ein.`
    : undefined,
)
const { errorId, errorBorder, errorAttrs } = useFieldError(message)

const boxes = computed(() => {
  const digits = props.tagInput.padStart(TAG_DIGITS, '0').split('')
  const firstNonZeroNumberIndex = digits.findIndex((digit) => digit !== '0')
  const leadingZeroCount = firstNonZeroNumberIndex === -1 ? digits.length : firstNonZeroNumberIndex

  return digits.map((digit, index) => ({
    digit,
    isLeadingZero: index < leadingZeroCount,
  }))
})
</script>

<template>
  <section class="my-3 mb-auto flex flex-col py-3 px-gutter">
    <div
      class="grid gap-2"
      role="status"
      v-bind="errorAttrs"
      :style="{ 'grid-template-columns': `repeat(${TAG_DIGITS}, minmax(0, 1fr))` }"
    >
      <span class="sr-only">{{
        tagInput !== '' ? `Stammnummer: ${tagInput}` : 'Keine Eingabe'
      }}</span>
      <div
        v-for="(box, index) in boxes"
        :key="index"
        class="flex h-20 items-center justify-center rounded-lg border-2 text-[56px] leading-none font-bold tabular-nums shorter:h-[60px] shorter:text-[42px]"
        :class="
          box.isLeadingZero
            ? 'border-line bg-well text-faint opacity-40'
            : ['bg-ink text-paper', errorBorder]
        "
        aria-hidden="true"
      >
        {{ box.digit }}
      </div>
    </div>
    <FieldError :id="errorId" :message="message" class="mt-2 text-center" />
  </section>
</template>
