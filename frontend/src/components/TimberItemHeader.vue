<script setup lang="ts">
import { XIcon } from '@lucide/vue'
import FormattedTag from '@/components/FormattedTag.vue'
import SyncButton from '@/components/SyncButton.vue'

defineProps<{
  tagNumber: number
  pendingCount: number
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <!-- Sticks to the top of the scrolling view; inverted to set it apart from the fields. -->
  <header
    class="sticky top-0 z-5 flex h-header shrink-0 items-center gap-3 bg-ink px-gutter text-paper"
  >
    <button
      type="button"
      class="flex size-11 items-center justify-center rounded-lg border-2 border-current"
      aria-label="Schließen"
      @click="emit('close')"
    >
      <XIcon :size="22" aria-hidden="true" />
    </button>
    <h1 class="flex flex-1 flex-col items-center gap-0.5 text-center">
      <small class="text-[13px] font-semibold tracking-[.06em]">STAMM</small>
      <!-- Letter spacing also adds space after the last digit; the negative right margin
           of the same size takes it back out, so the number stays centred. -->
      <FormattedTag
        :tag-number="tagNumber"
        :zero-opacity="50"
        class="-mr-[.05em] text-[40px] leading-none font-extrabold tracking-[.05em] tabular-nums"
      />
    </h1>
    <SyncButton :pending-count="pendingCount" inverted />
  </header>
</template>
