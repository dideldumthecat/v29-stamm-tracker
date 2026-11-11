<script setup lang="ts">
import { computed, onMounted, onUnmounted, useId, useTemplateRef } from 'vue'

const props = defineProps<{
  // Plain text; use the `title` slot instead for a formatted tag.
  title?: string
  // The safe choice (e.g. keep editing): focused first, and what Escape and a tap on the backdrop trigger.
  safeLabel: string
  // The other choice (e.g. discard, remove, save). Without it the sheet only informs.
  actionLabel?: string
  // The action is the expected one: it gets the filled button instead of the safe choice.
  emphasizeAction?: boolean
  // A question with several equal answers instead of one action: one button each, the safe choice set apart below.
  // The sheet then insists on an answer: a tap on the backdrop does nothing.
  choices?: { value: string; label: string }[]
}>()
const emit = defineEmits<{ safe: []; action: []; choose: [value: string] }>()

const filled =
  'flex h-14 w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper'
const outlined = 'h-14 w-full rounded-lg border-2 border-ink bg-paper text-label font-bold'

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
  // Keep the focus inside: the page behind the sheet must not be reachable by keyboard.
  if (event.key === 'Tab') {
    const focusable = [...(buttonRow.value?.querySelectorAll('button') ?? [])]
    const index = focusable.indexOf(document.activeElement as HTMLButtonElement)
    const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
    event.preventDefault()
    // From outside the sheet: Tab lands on the first button, Shift+Tab on the last.
    focusable[index === -1 && event.shiftKey ? focusable.length - 1 : next]?.focus()
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
      @click.self="choices || emit('safe')"
    >
      <div
        class="flex max-h-[90%] w-full max-w-[430px] flex-col gap-3.5 rounded-t-[14px] bg-paper pt-5 px-gutter pb-safe-5"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <h2 :id="titleId" class="shrink-0 text-xl font-bold text-balance">
          <slot name="title">{{ title }}</slot>
        </h2>
        <!-- Long content scrolls on its own; title and buttons stay in view. -->
        <div class="min-h-0 overflow-y-auto text-detail leading-message"><slot /></div>
        <div ref="buttonRow" class="mt-1 flex shrink-0 flex-col gap-2">
          <button
            v-for="choice in choices"
            :key="choice.value"
            type="button"
            :class="filled"
            @click="emit('choose', choice.value)"
          >
            {{ choice.label }}
          </button>
          <button
            v-if="choices"
            data-safe
            type="button"
            :class="[outlined, 'mt-2']"
            @click="emit('safe')"
          >
            {{ safeLabel }}
          </button>
          <template v-else>
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
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
