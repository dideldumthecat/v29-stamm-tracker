<script setup lang="ts">
import { ref } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { InfoIcon } from '@lucide/vue'
import type { KeyFigure } from '@v29/shared/contract'

import { formatFigure, formatPercent } from '@/keyFigures'

/**
 * The card "Kennzahlen": one row per figure in the grid of the attribute rows, with a button that opens the formula.
 * It only shows what the server calculated (`formula`, `inserted`, `note` come ready from it).
 */
defineProps<{ figures: KeyFigure[] }>()

// Only one formula is open at a time; opening another closes the first.
const openKey = ref<string | null>(null)
</script>

<template>
  <section class="card p-4 sm:p-6" aria-labelledby="key-figures-heading">
    <h2 id="key-figures-heading" class="text-lg font-bold">Kennzahlen</h2>
    <dl class="mt-2 divide-y divide-soft">
      <div
        v-for="figure in figures"
        :key="figure.key"
        class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 py-3"
      >
        <dt class="text-caption font-semibold wrap-anywhere text-mute">{{ figure.label }}</dt>
        <!-- The button hangs 13 px into the card padding, so that the icon (18 px in a 44 px target) ends at the content edge;
             centred on the text block (value and source), it does not make the row taller. -->
        <dd class="relative" :class="figure.value !== null && 'pr-8'">
          <p class="leading-snug">
            <span
              v-if="figure.value === null"
              role="img"
              aria-label="nicht berechenbar"
              class="block text-mute"
              >–</span
            >
            <span v-else-if="figure.key === 'yield'" class="block text-mute tabular-nums">
              <span class="text-[22px] leading-7">{{ formatPercent(figure.value) }}</span
              >&nbsp;%
            </span>
            <span v-else class="block text-ink tabular-nums">{{ formatFigure(figure) }}</span>
            <span class="block text-caption wrap-anywhere text-mute">{{ figure.source }}</span>
          </p>
          <PopoverRoot
            v-if="figure.value !== null"
            :open="openKey === figure.key"
            @update:open="(open: boolean) => (openKey = open ? figure.key : null)"
          >
            <PopoverTrigger
              :aria-label="`Formel für ${figure.label} anzeigen`"
              class="absolute top-1/2 -right-[13px] flex size-11 -translate-y-1/2 items-center justify-center text-mute data-[state=open]:text-ink"
            >
              <InfoIcon :size="18" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                side="bottom"
                align="end"
                :side-offset="4"
                :collision-padding="8"
                class="z-40 w-[372px] max-w-[calc(100vw-2rem)] rounded-lg border border-ink bg-paper p-4 text-ink"
              >
                <h3 class="text-[15px] font-bold">So wird {{ figure.label }} berechnet</h3>
                <dl class="mt-3 space-y-2 text-sm">
                  <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
                    <dt class="font-semibold text-mute">Formel</dt>
                    <dd class="wrap-anywhere">{{ figure.formula }}</dd>
                  </div>
                  <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
                    <dt class="font-semibold text-mute">Eingesetzt</dt>
                    <dd class="wrap-anywhere">{{ figure.inserted }}</dd>
                  </div>
                  <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
                    <dt class="font-semibold text-mute">Ergebnis</dt>
                    <dd class="font-bold tabular-nums">{{ formatFigure(figure) }}</dd>
                  </div>
                </dl>
                <p v-if="figure.note" class="mt-3 border-t border-soft pt-3 text-caption text-mute">
                  {{ figure.note }}
                </p>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
        </dd>
      </div>
    </dl>
  </section>
</template>
