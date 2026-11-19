<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'

/**
 * A native `<select>` (keyboard and screen readers stay the browser's) with the chevron of the filter buttons instead of the browser's
 * arrow. `class` goes to the wrapper (width), everything else (`id`, `disabled`, `aria-*`) to the select; the options are the slot.
 */
defineOptions({ inheritAttrs: false })
const model = defineModel<string>()
const attrs = useAttrs()
const selectAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([name]) => name !== 'class')),
)
</script>

<template>
  <div class="relative" :class="attrs.class">
    <select
      v-bind="selectAttrs"
      v-model="model"
      class="peer h-11 w-full appearance-none rounded-lg border-2 border-ink bg-paper pr-10 pl-3 text-base text-ink disabled:border-line disabled:text-dim aria-invalid:bg-well"
    >
      <slot />
    </select>
    <!-- 12 px from the edge of the border, 18 px wide: the text never reaches it (pr-10 = 40 px) -->
    <ChevronDownIcon
      :size="18"
      class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink peer-disabled:text-dim"
      aria-hidden="true"
    />
  </div>
</template>
