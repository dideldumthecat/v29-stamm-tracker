<script setup lang="ts">
import { onMounted, onUnmounted, useId, useTemplateRef } from 'vue'

defineProps<{
  title: string
  primaryLabel: string
  secondaryLabel: string
}>()
// primary = the safe choice (e.g. keep editing); also triggered by backdrop tap and Escape.
const emit = defineEmits<{ primary: []; secondary: [] }>()

const titleId = useId()
const primaryButton = useTemplateRef<HTMLButtonElement>('primaryButton')

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('primary')
  }
}

onMounted(() => {
  // Move focus into the dialog, so keyboard and screen reader users land on the safe choice.
  primaryButton.value?.focus()
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Teleport: render at body level, independent of the app frame's overflow and stacking. -->
  <Teleport to="body">
    <div
      class="fixed inset-0 z-40 flex items-end justify-center bg-ink/50"
      @click.self="emit('primary')"
    >
      <div
        class="flex max-h-[90%] w-full max-w-[430px] flex-col gap-3.5 overflow-auto rounded-t-[14px] bg-paper pt-5 px-gutter pb-safe-5"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <h2 :id="titleId" class="text-xl font-bold text-balance">{{ title }}</h2>
        <div class="text-[15px] leading-[1.45]"><slot /></div>
        <div class="mt-1 flex flex-col gap-2">
          <button
            ref="primaryButton"
            type="button"
            class="flex h-14 w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper"
            @click="emit('primary')"
          >
            {{ primaryLabel }}
          </button>
          <button
            type="button"
            class="h-14 w-full rounded-lg border-2 border-ink bg-paper text-[17px] font-bold"
            @click="emit('secondary')"
          >
            {{ secondaryLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
