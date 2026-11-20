<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { InfoIcon } from '@lucide/vue'

/**
 * The info button of a figure (detail view and dashboard): opens formula, inserted values, result and note, all as the server wrote them.
 * The parent places the button (its classes go to the button) and decides which one is open.
 */
defineOptions({ inheritAttrs: false })
defineProps<{
  label: string
  formula: string
  inserted: string | null
  /** The formatted value */
  result: string
  note: string | null
}>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      v-bind="$attrs"
      :aria-label="`Formel für ${label} anzeigen`"
      class="flex size-11 items-center justify-center text-mute data-[state=open]:text-ink"
    >
      <InfoIcon :size="18" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="4"
        :collision-padding="8"
        class="z-40 w-[372px] max-w-[calc(100vw-2rem)] rounded-lg border border-ink bg-paper p-4 text-left text-ink"
      >
        <h3 class="text-[15px] font-bold">So wird {{ label }} berechnet</h3>
        <dl class="mt-3 space-y-2 text-sm">
          <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
            <dt class="font-semibold text-mute">Formel</dt>
            <dd class="wrap-anywhere">{{ formula }}</dd>
          </div>
          <div v-if="inserted !== null" class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
            <dt class="font-semibold text-mute">Eingesetzt</dt>
            <dd class="wrap-anywhere">{{ inserted }}</dd>
          </div>
          <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
            <dt class="font-semibold text-mute">Ergebnis</dt>
            <dd class="font-bold tabular-nums">{{ result }}</dd>
          </div>
        </dl>
        <p v-if="note" class="mt-3 border-t border-soft pt-3 text-caption text-mute">
          {{ note }}
        </p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
