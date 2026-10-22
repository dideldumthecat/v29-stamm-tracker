<script setup lang="ts">
import { XIcon } from '@lucide/vue'
import FormattedTag from '@/components/FormattedTag.vue'
import { useToast } from '@/composables/useToast'

const { current, hide } = useToast()
</script>

<template>
  <!-- Swipe-to-dismiss from the click prototype comes later. -->
  <Teleport to="body">
    <div
      v-if="current"
      class="fixed top-safe-3 left-1/2 z-60 flex w-[calc(100%-32px)] max-w-[398px] -translate-x-1/2 items-center justify-between gap-3 rounded-lg border-2 border-ink bg-paper py-2.5 pr-1.5 pl-4 text-[15px] leading-[1.35] font-semibold text-ink shadow-lg select-none"
      role="status"
    >
      <span class="min-w-0 flex-1"
        >{{ current.before }}
        <FormattedTag v-if="current.tagNumber !== undefined" :tag-number="current.tagNumber" />
        {{ current.after }}</span
      >
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center text-ink"
        aria-label="Hinweis schließen"
        @click="hide"
      >
        <XIcon :size="22" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>
