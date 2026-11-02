<script setup lang="ts">
import { computed, onMounted, onUnmounted, useId, useTemplateRef } from 'vue'

const props = defineProps<{
  // Plain text; use the `title` slot instead for a formatted tag.
  title?: string
  // The safe choice (e.g. keep editing): focused first, and what Escape and a tap on the backdrop trigger.
  safeLabel: string
  // The other choice (e.g. discard, remove, save and open). Without it the sheet only informs.
  actionLabel?: string
  // The action is the expected one: it gets the filled button instead of the safe choice.
  emphasizeAction?: boolean
}>()
const emit = defineEmits<{ safe: []; action: [] }>()

const filled =
  'flex h-14 w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper'
const outlined = 'h-14 w-full rounded-lg border-2 border-ink bg-paper text-[17px] font-bold'

// The filled button stands on top, the outlined one below it. Order in the DOM too, so Tab follows what is seen.
const buttons = computed(() => {
  const safe = { key: 'safe' as const, label: props.safeLabel, isSafe: true }
  if (!props.actionLabel) {
    return [safe]
  }
  const action = { key: 'action' as const, label: props.actionLabel, isSafe: false }
  return props.emphasizeAction ? [action, safe] : [safe, action]
})

const titleId = useId()
const buttonRow = useTemplateRef<HTMLElement>('buttonRow')

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    emit('safe')
  }
}

onMounted(() => {
  // Move focus into the dialog, so keyboard and screen reader users land on the safe choice.
  buttonRow.value?.querySelector<HTMLButtonElement>('[data-safe]')?.focus()
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Teleport: render at body level, independent of the app frame's overflow and stacking. -->
  <Teleport to="body">
    <div
      class="fixed inset-0 z-40 flex items-end justify-center bg-ink/50"
      @click.self="emit('safe')"
    >
      <div
        class="flex max-h-[90%] w-full max-w-[430px] flex-col gap-3.5 overflow-auto rounded-t-[14px] bg-paper pt-5 px-gutter pb-safe-5"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <h2 :id="titleId" class="text-xl font-bold text-balance">
          <slot name="title">{{ title }}</slot>
        </h2>
        <div class="text-[15px] leading-[1.45]"><slot /></div>
        <div ref="buttonRow" class="mt-1 flex flex-col gap-2">
          <button
            v-for="button in buttons"
            :key="button.key"
            :data-safe="button.isSafe || undefined"
            type="button"
            :class="button.isSafe === !emphasizeAction ? filled : outlined"
            @click="button.isSafe ? emit('safe') : emit('action')"
          >
            {{ button.label }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
