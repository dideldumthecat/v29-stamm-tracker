<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { InfoIcon } from '@lucide/vue'

/**
 * An info button with a pop-up beside it (the formula of a figure, the notes of a dashboard table). The parent places the button
 * (its classes go to the button) and decides whether it is open; the content is the slot.
 * `wide`: for a list of terms after a heading, wider and opening to the right of the button; the formulas open to its left.
 */
defineOptions({ inheritAttrs: false })
defineProps<{ buttonLabel: string; wide?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      v-bind="$attrs"
      :aria-label="buttonLabel"
      class="flex size-11 items-center justify-center text-mute data-[state=open]:text-ink"
    >
      <InfoIcon :size="18" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        :align="wide ? 'start' : 'end'"
        :side-offset="4"
        :collision-padding="8"
        class="z-40 max-w-[calc(100vw-2rem)] rounded-lg border border-ink bg-paper p-4 text-left text-ink"
        :class="wide ? 'w-[600px]' : 'w-[372px]'"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
