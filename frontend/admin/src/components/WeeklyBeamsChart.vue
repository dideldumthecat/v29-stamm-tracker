<script setup lang="ts">
import { computed } from 'vue'
import type { PileCardSection } from '@/api/contract'

import WeeklyColumns from '@/components/WeeklyColumns.vue'
import { chartDescription } from '@/pileCard'

/** "Gesägte Balken pro Woche" of a pile card: large below, small above, the sum above them and under it large / small. */
const props = defineProps<{ section: PileCardSection }>()

const series = computed(() => [
  { label: props.section.size_labels.large, bar: 'bg-beam-large' },
  { label: props.section.size_labels.small, bar: 'bg-beam-small' },
])
const weeks = computed(() =>
  props.section.weeks.map((week) => ({
    weekStart: week.week_start,
    values: [week.large, week.small],
  })),
)
</script>

<template>
  <WeeklyColumns
    title="Gesägte Balken pro Woche"
    :series="series"
    :weeks="weeks"
    :average="section.average_per_week"
    :description="chartDescription(section)"
  >
    <!-- The sum, and below it large / small (both, also when one is 0); an empty week has only the 0 -->
    <template #top="{ values: [large, small], total }">
      <span class="block text-sm leading-5 font-bold tabular-nums">{{ total }}</span>
      <span v-if="total" class="block text-xs leading-4 whitespace-nowrap tabular-nums" data-split
        ><span class="font-bold text-body">{{ large }}</span
        ><span class="text-beam-small-text"> / {{ small }}</span></span
      >
    </template>
  </WeeklyColumns>
</template>
