<script setup lang="ts">
const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const emit = defineEmits<{
  digit: [value: string]
  clear: []
  delete: []
}>()
</script>

<template>
  <div
    class="grid min-h-0 touch-manipulation auto-rows-[minmax(52px,72px)] grid-cols-3 content-end gap-2 select-none px-gutter"
    role="group"
    aria-label="Ziffernfeld"
  >
    <button
      v-for="digit in digits"
      :key="digit"
      type="button"
      class="flex touch-manipulation items-center justify-center rounded-[10px] border-2 border-ink bg-well text-3xl font-semibold active:bg-ink active:text-paper"
      @click="emit('digit', digit)"
    >
      {{ digit }}
    </button>

    <button
      type="button"
      class="flex touch-manipulation items-center justify-center rounded-[10px] border-2 border-ink bg-paper text-base font-semibold active:bg-ink active:text-paper"
      @click="emit('clear')"
    >
      Leeren
    </button>
    <button
      type="button"
      class="flex touch-manipulation items-center justify-center rounded-[10px] border-2 border-ink bg-well text-3xl font-semibold active:bg-ink active:text-paper"
      @click="emit('digit', '0')"
    >
      0
    </button>
    <button
      type="button"
      class="flex touch-manipulation items-center justify-center rounded-[10px] border-2 border-ink bg-paper text-base font-semibold active:bg-ink active:text-paper"
      aria-label="Letzte Ziffer löschen"
      @click="emit('delete')"
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M21 5H9l-6 7 6 7h12z" />
        <path d="M17 9l-6 6M11 9l6 6" />
      </svg>
    </button>
  </div>
</template>
