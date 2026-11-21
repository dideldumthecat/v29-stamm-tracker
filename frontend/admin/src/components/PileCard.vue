<script setup lang="ts">
import { computed, ref } from 'vue'
import { ExternalLinkIcon } from '@lucide/vue'
import type { DashboardPileSection } from '@v29/shared/contract'

import InfoPopover from '@/components/InfoPopover.vue'
import WeeklyBeamsChart from '@/components/WeeklyBeamsChart.vue'
import { formatOneDecimal, formatTwoDecimals } from '@/keyFigures'
import { progressText, stemsText } from '@/pileCard'
import { formatVolume, mapUrl } from '@/piles'

/**
 * The card of one pile on the dashboard: progress and yield side by side (stacked on a phone), below them the sawn beams per week.
 * All numbers come from the server; the card only formats them and sizes the bars.
 */
const props = defineProps<{ section: DashboardPileSection }>()

const notesOpen = ref(false)
const map = computed(() => mapUrl(props.section))
const progress = computed(() => props.section.progress)
const processed = computed(() => progress.value.sawn + progress.value.not_sawable)
const yieldOf = computed(() => props.section.yield)
const percent = (share: number) => `${formatOneDecimal(share * 100)} %`
</script>

<template>
  <section class="mt-6 card p-4 sm:p-6" :aria-labelledby="`section-${section.key}`">
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
        <div class="flex items-baseline justify-between gap-4">
          <h3 class="text-label font-bold">Fortschritt</h3>
          <span class="text-3xl tabular-nums">{{ progressText(section) }}</span>
        </div>
        <!-- 2 px white gaps between the parts; the widths are the counts, so the parts are as wide as their share -->
        <div
          class="mt-3 flex h-[18px] gap-0.5"
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
        <div class="flex items-baseline justify-between gap-4">
          <h3 class="text-label font-bold">Ausbeute</h3>
          <span class="text-3xl tabular-nums">
            <span v-if="yieldOf.ratio === null" role="img" aria-label="nicht berechenbar">–</span>
            <template v-else>{{ percent(yieldOf.ratio) }}</template>
          </span>
        </div>
        <!-- Dark = sawn timber, light = the rest; without a yield an empty place keeps the two sides level -->
        <div
          v-if="yieldOf.ratio !== null"
          class="mt-3 h-[18px] overflow-hidden rounded-xs bg-line"
          role="img"
          :aria-label="`Ausbeute ${percent(yieldOf.ratio)}`"
        >
          <span class="block h-full bg-ink" :style="{ width: `${yieldOf.ratio * 100}%` }" />
        </div>
        <div v-else class="mt-3 h-[18px]" aria-hidden="true" />
        <p v-if="progress.sawn === 0" class="mt-3 text-mute">Noch kein Stamm gesägt</p>
        <template v-else>
          <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mute">
            <li v-if="yieldOf.sawn_timber_m3 !== null" class="flex items-center gap-2">
              <span class="size-3 shrink-0 rounded-xs bg-ink" aria-hidden="true" /><span
                ><b class="text-ink">{{ formatTwoDecimals(yieldOf.sawn_timber_m3) }}&nbsp;m³</b>
                Schnittholz</span
              >
            </li>
            <li v-if="yieldOf.waste_fm !== null" class="flex items-center gap-2">
              <span class="size-3 shrink-0 rounded-xs bg-line" aria-hidden="true" /><span
                ><b class="text-ink">{{ formatTwoDecimals(yieldOf.waste_fm) }}&nbsp;fm</b>
                Verschnitt (Rinde, Schwarten, Späne)</span
              >
            </li>
          </ul>
          <p class="mt-1 text-sm text-mute">
            <template v-if="yieldOf.round_wood_fm !== null"
              >aus {{ formatTwoDecimals(yieldOf.round_wood_fm) }} fm Rundholz der gesägten
              Stämme</template
            ><template v-else>Rundholz der gesägten Stämme nicht berechenbar</template>
          </p>
        </template>
      </div>
    </div>

    <WeeklyBeamsChart v-if="section.weeks.length" :section="section" />
  </section>
</template>
