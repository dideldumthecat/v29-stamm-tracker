<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DashboardPileSection } from '@v29/shared/contract'

import { formatOneDecimal } from '@/keyFigures'
import { axisSteps, chartDescription, weekLabel, weekTotal } from '@/pileCard'
import { useScrollStart } from '@/scrollEnd'

/**
 * "Gesägte Balken pro Woche" of a pile card: stacked columns (large below, small above, the sum above them) with a fixed axis.
 * Only the columns scroll, sideways, starting at the current week (the last one); the grid lines and the average stay put across the
 * whole width. Everything is drawn from the numbers of the server, the average included.
 */
const props = defineProps<{ section: DashboardPileSection }>()

/** The height of the area of the columns in px, and the room above it for the two lines (sum, large / small) of the tallest column. */
const PLOT = 160
const HEADROOM = 44

const scroller = ref<HTMLElement | null>(null)
const { hiddenLeft } = useScrollStart(scroller)

const axis = computed(() => axisSteps(Math.max(...props.section.weeks.map(weekTotal))))
/** Distance of a value from the bottom of the area of the columns, in px. */
const height = (value: number) => (value / axis.value.top) * PLOT
const average = computed(() => props.section.average_per_week)
/** The dashes of the average line. */
const DASHES = '6 4'
</script>

<template>
  <div class="mt-6 border-t border-soft pt-6">
    <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <h3 class="text-label font-bold">Gesägte Balken pro Woche</h3>
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-mute">
        <li class="flex items-center gap-2">
          <span class="size-3 rounded-xs bg-beam-large" aria-hidden="true" />{{
            section.size_labels.large
          }}
        </li>
        <li class="flex items-center gap-2">
          <span class="size-3 rounded-xs bg-beam-small" aria-hidden="true" />{{
            section.size_labels.small
          }}
        </li>
        <li v-if="average !== null" class="flex items-center gap-2">
          <svg width="24" height="4" aria-hidden="true">
            <line
              x1="0"
              y1="2"
              x2="24"
              y2="2"
              class="stroke-ink"
              stroke-width="1.5"
              :stroke-dasharray="DASHES"
            />
          </svg>
          Ø {{ formatOneDecimal(average) }} pro Woche
        </li>
      </ul>
    </div>

    <div class="mt-4 flex" role="img" :aria-label="chartDescription(section)">
      <!-- Axis: stays where it is while the columns scroll -->
      <div
        class="relative w-8 shrink-0 text-caption text-mute tabular-nums"
        :style="{ height: `${HEADROOM + PLOT}px` }"
        aria-hidden="true"
      >
        <span
          v-for="tick in axis.ticks"
          :key="tick"
          class="absolute right-2 translate-y-1/2"
          :style="{ bottom: `${height(tick)}px` }"
          >{{ tick }}</span
        >
      </div>

      <div class="relative min-w-0 flex-1">
        <div
          class="pointer-events-none absolute inset-x-0 top-0"
          :style="{ height: `${HEADROOM + PLOT}px` }"
          aria-hidden="true"
        >
          <span
            v-for="tick in axis.ticks"
            :key="tick"
            class="absolute inset-x-0 h-px bg-soft"
            :style="{ bottom: `${height(tick)}px` }"
          />
        </div>

        <!-- Order of drawing: grid, this line, the columns, the numbers above the columns (z-10), the fade (z-20); across the whole width, scrolling or not -->
        <svg
          v-if="average !== null"
          class="pointer-events-none absolute inset-x-0 top-0 w-full"
          :height="HEADROOM + PLOT"
          aria-hidden="true"
          data-average
        >
          <line
            x1="0"
            x2="100%"
            :y1="HEADROOM + PLOT - height(average)"
            :y2="HEADROOM + PLOT - height(average)"
            class="stroke-ink"
            stroke-width="1.5"
            :stroke-dasharray="DASHES"
          />
        </svg>
        <div ref="scroller" class="relative overflow-x-auto overflow-y-hidden">
          <ol class="flex w-max min-w-full gap-8 px-4">
            <li v-for="(week, index) in section.weeks" :key="week.week_start" class="w-16 shrink-0">
              <div
                class="flex flex-col justify-end gap-0.5"
                :style="{ height: `${HEADROOM + PLOT}px` }"
              >
                <!-- Sum, and below it large / small (both, also when one is 0); an empty week has only the 0. z-10: above the columns, with a white edge so that the grid and the average line are left out where they cross a number -->
                <span class="relative z-10 mb-0.5 text-center text-halo">
                  <span class="block text-sm leading-5 font-bold tabular-nums">{{
                    weekTotal(week)
                  }}</span>
                  <span
                    v-if="weekTotal(week)"
                    class="block text-xs leading-4 whitespace-nowrap tabular-nums"
                    data-split
                    ><span class="font-bold text-beam-large">{{ week.large }}</span
                    ><span class="text-beam-small-text"> / {{ week.small }}</span></span
                  >
                </span>
                <span
                  v-if="week.small"
                  class="block bg-beam-small"
                  :style="{ height: `${height(week.small)}px` }"
                />
                <span
                  v-if="week.large"
                  class="block bg-beam-large"
                  :style="{ height: `${height(week.large)}px` }"
                />
              </div>
              <div class="mt-2 text-center">
                <div class="font-semibold">
                  {{ weekLabel(week.week_start, index === section.weeks.length - 1).title }}
                </div>
                <div class="text-caption whitespace-nowrap text-mute">
                  {{ weekLabel(week.week_start, index === section.weeks.length - 1).period }}
                </div>
              </div>
            </li>
          </ol>
        </div>

        <!-- The older weeks fade out on the left as long as they are hidden -->
        <div
          v-if="hiddenLeft"
          class="pointer-events-none absolute inset-y-0 left-0 z-20 w-12 bg-linear-to-r from-paper to-transparent"
          aria-hidden="true"
          data-fade
        />
      </div>
    </div>
  </div>
</template>
