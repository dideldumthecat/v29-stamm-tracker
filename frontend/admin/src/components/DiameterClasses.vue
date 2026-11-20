<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownWideNarrowIcon, ArrowUpNarrowWideIcon, ChevronsUpDownIcon } from '@lucide/vue'
import type { DashboardDiameterSection } from '@v29/shared/contract'

import InfoPopover from '@/components/InfoPopover.vue'
import { DEFAULT_DIAMETER_SORT, sortClasses, sortOn, type DiameterColumn } from '@/diameterClasses'
import { formatOneDecimal } from '@/keyFigures'

/**
 * The dashboard section "Stämme nach Mittendurchmesser": a table that sorts on every column. The row "ohne Durchmesser" stays last.
 * Narrow, each row stacks: diameter and count, the bar, then yield and beams per stem with their names.
 */
const props = defineProps<{ section: DashboardDiameterSection }>()

const COLUMNS: { id: DiameterColumn; label: string; right?: true }[] = [
  { id: 'diameter', label: 'Durchmesser' },
  { id: 'stems', label: 'Stämme' },
  { id: 'yield', label: 'Ausbeute', right: true },
  { id: 'beams_per_stem', label: 'Balken je Stamm', right: true },
]

const notesOpen = ref(false)
const sort = ref(DEFAULT_DIAMETER_SORT)
const rows = computed(() => sortClasses(props.section.rows, sort.value))
// The bars are relative to the largest row, "ohne Durchmesser" included, so that none overflows
const largest = computed(() =>
  Math.max(1, props.section.without_diameter, ...props.section.rows.map((row) => row.stems)),
)
const barWidth = (stems: number) => `${(stems / largest.value) * 100}%`
const stemsText = (stems: number) => `${stems} ${stems === 1 ? 'Stamm' : 'Stämme'}`
</script>

<template>
  <section class="mt-6 card p-4 sm:p-6" :aria-labelledby="`section-${section.key}`">
    <!-- The button stands beside the heading, not in it: the heading keeps its name -->
    <div class="flex items-center">
      <h2 :id="`section-${section.key}`" class="text-lg font-bold">{{ section.label }}</h2>
      <InfoPopover
        v-model:open="notesOpen"
        :button-label="`Erklärung zeigen: ${section.label}`"
        wide
        class="-my-2"
      >
        <!-- One line per term; narrow, the term stands above its text -->
        <dl class="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          <template v-for="note in section.notes" :key="note.term">
            <dt class="font-semibold text-mute max-sm:not-first:mt-1">{{ note.term }}</dt>
            <dd class="max-sm:-mt-2">{{ note.text }}</dd>
          </template>
        </dl>
      </InfoPopover>
    </div>
    <table class="mt-3 w-full text-detail tabular-nums max-sm:block sm:table-fixed">
      <colgroup>
        <col class="w-45" />
        <col />
        <col class="w-12" />
        <col class="w-[110px]" />
        <col class="w-[130px]" />
      </colgroup>
      <thead class="max-sm:block">
        <tr class="max-sm:flex max-sm:flex-wrap max-sm:gap-x-4">
          <th
            v-for="column in COLUMNS"
            :key="column.id"
            scope="col"
            :colspan="column.id === 'stems' ? 2 : undefined"
            :class="column.right ? 'sm:text-right' : 'text-left'"
            :aria-sort="
              column.id === sort.column
                ? sort.dir === 'desc'
                  ? 'descending'
                  : 'ascending'
                : undefined
            "
          >
            <button
              type="button"
              class="inline-flex min-h-11 items-center text-caption hover:underline"
              :class="column.id === sort.column ? 'font-bold text-ink' : 'font-semibold text-mute'"
              @click="sort = sortOn(sort, column.id)"
            >
              {{ column.label
              }}<component
                :is="
                  column.id !== sort.column
                    ? ChevronsUpDownIcon
                    : sort.dir === 'desc'
                      ? ArrowDownWideNarrowIcon
                      : ArrowUpNarrowWideIcon
                "
                :size="column.id === sort.column ? 20 : 16"
                :stroke-width="column.id === sort.column ? 2.5 : 2"
                class="ml-1"
                :class="column.id === sort.column ? 'text-ink' : 'text-faint'"
                aria-hidden="true"
              />
            </button>
          </th>
        </tr>
      </thead>
      <tbody class="max-sm:block">
        <!-- Narrow, a row is a grid: diameter | count, the bar across, yield | beams per stem -->
        <tr
          v-for="row in rows"
          :key="row.from_cm"
          class="border-t border-soft max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-4 max-sm:gap-y-1 max-sm:py-3"
        >
          <th scope="row" class="py-3 text-left font-normal max-sm:py-0">
            <!-- Whole cm: the class 32 to 34 holds 32 and 33 cm -->
            {{ row.from_cm }}–{{ row.to_cm - 1 }} cm
            <span v-if="row.not_sawable" class="block text-caption text-mute"
              >davon {{ row.not_sawable }} nicht sägbar</span
            >
          </th>
          <td class="py-3 max-sm:col-span-2 max-sm:row-start-2 max-sm:py-1">
            <span
              role="img"
              :aria-label="stemsText(row.stems)"
              class="block h-[18px] rounded bg-ink"
              :style="{ width: barWidth(row.stems) }"
            />
          </td>
          <td class="py-3 pl-3 max-sm:col-start-2 max-sm:row-start-1 max-sm:py-0 max-sm:text-right">
            {{ row.stems }}
          </td>
          <td class="py-3 text-right max-sm:py-0 max-sm:text-left">
            <span class="text-mute sm:hidden">Ausbeute </span>
            <span v-if="row.yield === null" role="img" aria-label="kein gesägter Stamm">–</span>
            <template v-else>{{ formatOneDecimal(row.yield * 100) }}&nbsp;%</template>
          </td>
          <td class="py-3 text-right max-sm:py-0">
            <span class="text-mute sm:hidden">Balken je Stamm </span>
            <span v-if="row.beams_per_stem === null" role="img" aria-label="kein gesägter Stamm"
              >–</span
            >
            <template v-else>{{ formatOneDecimal(row.beams_per_stem) }}</template>
          </td>
        </tr>
        <tr
          v-if="section.without_diameter"
          class="border-t border-soft max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-4 max-sm:gap-y-1 max-sm:py-3"
        >
          <th scope="row" class="py-3 text-left font-normal max-sm:py-0">ohne Durchmesser</th>
          <td class="py-3 max-sm:col-span-2 max-sm:row-start-2 max-sm:py-1">
            <span
              role="img"
              :aria-label="stemsText(section.without_diameter)"
              class="block h-[18px] rounded bg-ink"
              :style="{ width: barWidth(section.without_diameter) }"
            />
          </td>
          <td class="py-3 pl-3 max-sm:col-start-2 max-sm:row-start-1 max-sm:py-0 max-sm:text-right">
            {{ section.without_diameter }}
          </td>
          <!-- Yield and beams per stem are not worked out without a class -->
          <td class="max-sm:hidden" />
          <td class="max-sm:hidden" />
        </tr>
      </tbody>
    </table>
  </section>
</template>
