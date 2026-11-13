<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue'

/**
 * A button of the filter bar with the pop-up of its filter (Reka UI Popover: anchored below the button, kept inside the window,
 * closed by Escape and a click outside, the focus returns to the button). The content comes as the slot and acts at once.
 * `id` is what the chips find the button by (`data-filter`); `count` is the badge for filters of several picks; `active`: a filter is set.
 */
defineProps<{ id: string; name: string; active?: boolean; count?: number }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      :data-filter="id"
      class="flex h-11 items-center gap-2 rounded-lg border-2 px-3 text-base"
      :class="active ? 'border-ink bg-paper font-bold' : 'border-dim bg-transparent'"
    >
      {{ name }}
      <span
        v-if="count"
        class="flex min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[13px] font-bold text-paper"
        >{{ count }}</span
      >
      <component :is="open ? ChevronUpIcon : ChevronDownIcon" :size="18" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :aria-label="name"
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        class="z-40 max-h-[min(28rem,var(--reka-popover-content-available-height))] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border-2 border-ink bg-paper p-2 text-base text-ink"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
