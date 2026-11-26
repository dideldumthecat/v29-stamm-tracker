<script setup lang="ts">
import { computed } from 'vue'
import type { PileCardSection } from '@/api/contract'

import WeeklyColumns from '@/components/WeeklyColumns.vue'
import { stemsChartDescription } from '@/pileCard'

/** "Bearbeitete Stämme pro Woche" of a pile card: one black column per week with the number above it, lower than the one of the beams. */
const props = defineProps<{ section: PileCardSection }>()

const series = [{ label: 'Gesägt oder nicht sägbar', bar: 'bg-ink' }]
const weeks = computed(() =>
  props.section.weeks.map((week) => ({ weekStart: week.week_start, values: [week.stems] })),
)
</script>

<template>
  <WeeklyColumns
    title="Bearbeitete Stämme pro Woche"
    :series="series"
    :weeks="weeks"
    :average="section.stems_average_per_week"
    :description="stemsChartDescription(section)"
    :plot="106"
    :headroom="26"
  />
</template>
