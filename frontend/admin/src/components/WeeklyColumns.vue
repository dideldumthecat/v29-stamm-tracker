<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'

import { formatOneDecimal } from '@/keyFigures'
import { axisSteps, weekLabel } from '@/pileCard'
import { useScrollStart } from '@/scrollEnd'

/**
 * A chart of columns per calendar week, stacked from one or more series (first series at the bottom), with a fixed axis.
 * Only the columns scroll, sideways, starting at the current week (the last one), with two arrows above them; the grid lines and the average stay put across the
 * whole width. Everything is drawn from the numbers of the server, the average included. "Gesägte Balken pro Woche" and "Bearbeitete Stämme pro Woche"
 * of a pile card differ only in their series and in what stands above a column.
 */
const props = withDefaults(
  defineProps<{
    title: string
    /** The legend entries and colours of the series, from the bottom up; `bar` is the background class of the column part */
    series: { label: string; bar: string }[]
    /** One entry per week, ascending; the last one is the current week. `values` has one number per series. */
    weeks: { weekStart: string; values: number[] }[]
    average: number | null
    /** What a screen reader gets instead of the drawing */
    description: string
    /** The height of the area of the columns in px, and the room above it for the numbers above the tallest column */
    plot?: number
    headroom?: number
  }>(),
  { plot: 160, headroom: 44 },
)

const scroller = ref<HTMLElement | null>(null)
const { hiddenLeft, hiddenRight } = useScrollStart(scroller)
function scrollChart(direction: -1 | 1) {
  // The optional call is for jsdom, which has no matchMedia
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  scroller.value?.scrollBy({
    left: direction * scroller.value.clientWidth * 0.6,
    behavior: reduced ? 'auto' : 'smooth',
  })
}

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)
const axis = computed(() => axisSteps(Math.max(...props.weeks.map((week) => total(week.values)))))
const area = computed(() => props.headroom + props.plot)
/** Distance of a value from the bottom of the area of the columns, in px. */
const height = (value: number) => (value / axis.value.top) * props.plot
/** The parts of a column from the top down, as they are drawn (the first series is at the bottom). */
const parts = (values: number[]) =>
  props.series.map((series, index) => ({ series, value: values[index]! })).reverse()
/** The dashes of the average line. */
const DASHES = '6 4'
</script>

<template>
  <div class="mt-6 border-t border-soft pt-6">
    <div class="flex items-center justify-between gap-x-6">
      <div>
        <h3 class="text-label font-bold">{{ title }}</h3>
        <ul class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mute">
          <li v-for="entry in series" :key="entry.label" class="flex items-center gap-2">
            <span class="size-3 rounded-xs" :class="entry.bar" aria-hidden="true" />{{
              entry.label
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
      <!-- Only for columns that do not fit; an arrow is disabled where there is nothing more to see (as the arrows of the stem list) -->
      <div v-if="hiddenLeft || hiddenRight" class="flex shrink-0 gap-2">
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-lg border-2 border-ink bg-paper disabled:border-line disabled:text-dim"
          :aria-label="`${title}: nach links scrollen`"
          :disabled="!hiddenLeft"
          @click="scrollChart(-1)"
        >
          <ChevronLeftIcon :size="22" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-lg border-2 border-ink bg-paper disabled:border-line disabled:text-dim"
          :aria-label="`${title}: nach rechts scrollen`"
          :disabled="!hiddenRight"
          @click="scrollChart(1)"
        >
          <ChevronRightIcon :size="22" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="mt-4 flex" role="img" :aria-label="description">
      <!-- Axis: stays where it is while the columns scroll -->
      <div
        class="relative w-8 shrink-0 text-caption text-mute tabular-nums"
        :style="{ height: `${area}px` }"
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
          :style="{ height: `${area}px` }"
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
          :height="area"
          aria-hidden="true"
          data-average
        >
          <line
            x1="0"
            x2="100%"
            :y1="area - height(average)"
            :y2="area - height(average)"
            class="stroke-ink"
            stroke-width="1.5"
            :stroke-dasharray="DASHES"
          />
        </svg>
        <div ref="scroller" class="relative overflow-x-auto overflow-y-hidden">
          <ol class="flex w-max min-w-full gap-8 px-4">
            <li v-for="(week, index) in weeks" :key="week.weekStart" class="w-16 shrink-0">
              <div class="flex flex-col justify-end gap-0.5" :style="{ height: `${area}px` }">
                <!-- z-10: above the columns, with a white edge so that the grid and the average line are left out where they cross a number -->
                <span class="relative z-10 mb-0.5 text-center text-halo">
                  <slot name="top" :values="week.values" :total="total(week.values)">
                    <span class="block text-sm leading-5 font-bold tabular-nums">{{
                      total(week.values)
                    }}</span>
                  </slot>
                </span>
                <template v-for="part in parts(week.values)" :key="part.series.label">
                  <span
                    v-if="part.value"
                    class="block"
                    :class="part.series.bar"
                    :style="{ height: `${height(part.value)}px` }"
                  />
                </template>
              </div>
              <div class="mt-2 text-center">
                <div class="font-semibold">
                  {{ weekLabel(week.weekStart, index === weeks.length - 1).title }}
                </div>
                <div class="text-caption whitespace-nowrap text-mute">
                  {{ weekLabel(week.weekStart, index === weeks.length - 1).period }}
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
