<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExternalLinkIcon } from '@lucide/vue'
import type { PileCardSection } from '@v29/shared/contract'

import InfoPopover from '@/components/InfoPopover.vue'
import WeeklyBeamsChart from '@/components/WeeklyBeamsChart.vue'
import { formatTwoDecimals } from '@/keyFigures'
import { beamTotals, progressText, stemsText } from '@/pileCard'
import { formatVolume, mapUrl } from '@/piles'

/**
 * The card of one pile on the page "Polter": progress and yield side by side (stacked on a phone), below them the sawn beams per week.
 * All numbers come from the server; the card only formats them, adds up the beams of the weeks and sizes the progress bar.
 */
const props = defineProps<{ section: PileCardSection }>()

const notesOpen = ref(false)
const map = computed(() => mapUrl(props.section))
const progress = computed(() => props.section.progress)
const processed = computed(() => progress.value.sawn + progress.value.not_sawable)
/** The three figures of "Ausbeute"; the surfaces of the beams are the colours of their columns in the chart. */
const figures = computed(() => {
  const beams = beamTotals(props.section)
  const sawnTimber = props.section.sawn_timber_m3
  const labels = props.section.size_labels
  return [
    {
      key: 'large',
      label: labels.large,
      value: beams.large,
      unit: 'Stück',
      surface: 'border-transparent bg-beam-large text-paper',
    },
    {
      key: 'small',
      label: labels.small,
      value: beams.small,
      unit: 'Stück',
      surface: 'border-transparent bg-beam-small',
    },
    {
      key: 'sawn-timber',
      label: 'Schnittholz',
      value: sawnTimber === null ? null : formatTwoDecimals(sawnTimber),
      unit: 'fm',
      surface: 'border-line bg-paper',
    },
  ]
})
</script>

<template>
  <section class="card p-4 sm:p-6" :aria-labelledby="`section-${section.key}`">
    <div class="flex items-center">
      <h2 :id="`section-${section.key}`" class="text-lg font-bold">{{ section.label }}</h2>
      <InfoPopover
        v-model:open="notesOpen"
        :button-label="`Erklärung zeigen: ${section.label}`"
        wide
        class="-my-2"
      >
        <dl class="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          <template v-for="note in section.notes" :key="note.term">
            <dt class="font-semibold text-mute max-sm:not-first:mt-1">{{ note.term }}</dt>
            <dd class="max-sm:-mt-2">{{ note.text }}</dd>
          </template>
        </dl>
      </InfoPopover>
    </div>
    <p class="text-mute" data-subtitle>
      {{ stemsText(section.stems)
      }}<template v-if="section.stacked_volume !== null">
        · {{ formatVolume(section.stacked_volume) }}</template
      ><template v-if="map">
        ·
        <a
          :href="map"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1.5 underline"
        >
          In OpenStreetMap öffnen
          <ExternalLinkIcon :size="16" aria-hidden="true" />
        </a>
      </template>
    </p>

    <div class="mt-6 grid gap-x-12 gap-y-8 md:grid-cols-2">
      <div data-progress>
        <h3 class="text-label font-bold">Fortschritt</h3>
        <!-- Starts level with the top of the figures of "Ausbeute", sized like their numbers, flush with the right end of the bar -->
        <p class="mt-3 text-right text-[40px] leading-none font-bold tabular-nums max-sm:text-3xl">
          {{ progressText(section) }}
        </p>
        <!-- 2 px white gaps between the parts; the widths are the counts, so the parts are as wide as their share -->
        <div
          class="mt-4 flex h-[18px] gap-0.5"
          role="img"
          :aria-label="`${progress.sawn} gesägt, ${progress.not_sawable} nicht sägbar, ${progress.open} offen`"
        >
          <span
            v-if="progress.sawn"
            class="rounded-xs bg-ink"
            :style="{ flex: `${progress.sawn} 1 0%` }"
          />
          <span
            v-if="progress.not_sawable"
            class="rounded-xs bg-hatched"
            :style="{ flex: `${progress.not_sawable} 1 0%` }"
          />
          <span
            v-if="progress.open"
            class="rounded-xs bg-line"
            :style="{ flex: `${progress.open} 1 0%` }"
          />
        </div>
        <p v-if="processed === 0" class="mt-3 text-mute">Noch kein Stamm verarbeitet</p>
        <ul v-else class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mute">
          <li class="flex items-center gap-2">
            <span class="size-3 rounded-xs bg-ink" aria-hidden="true" /><span
              ><b class="text-ink">{{ progress.sawn }}</b> gesägt</span
            >
          </li>
          <li class="flex items-center gap-2">
            <span class="size-3 rounded-xs bg-hatched" aria-hidden="true" /><span
              ><b class="text-ink">{{ progress.not_sawable }}</b> nicht sägbar</span
            >
          </li>
          <li class="flex items-center gap-2">
            <span class="size-3 rounded-xs bg-line" aria-hidden="true" /><span
              ><b class="text-ink">{{ progress.open }}</b> offen</span
            >
          </li>
        </ul>
      </div>

      <div data-yield>
        <h3 class="text-label font-bold">Ausbeute</h3>
        <dl class="mt-3 flex gap-3 sm:gap-8">
          <div
            v-for="figure in figures"
            :key="figure.key"
            class="max-w-[168px] min-w-0 flex-1 rounded-xl border px-5 py-4"
            :class="figure.surface"
            :data-figure="figure.key"
          >
            <dt class="text-caption font-semibold">{{ figure.label }}</dt>
            <dd
              class="mt-1.5 flex items-baseline justify-end gap-1 text-[40px] leading-none font-bold tabular-nums max-sm:text-3xl"
            >
              <span v-if="figure.value === null" role="img" aria-label="nicht berechenbar">–</span>
              <template v-else>
                {{ figure.value }}<span class="text-label font-semibold">{{ figure.unit }}</span>
              </template>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <WeeklyBeamsChart v-if="section.weeks.length" :section="section" />
  </section>
</template>
