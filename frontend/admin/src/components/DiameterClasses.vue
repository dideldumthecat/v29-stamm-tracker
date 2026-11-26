<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowDownWideNarrowIcon,
  ArrowRightIcon,
  ArrowUpNarrowWideIcon,
  ChevronsUpDownIcon,
} from '@lucide/vue'
import { formatDiameterClass } from '@/diameterClasses'
import type { DashboardDiameterSection } from '@/api/contract'

import InfoPopover from '@/components/InfoPopover.vue'
import { DEFAULT_DIAMETER_SORT, sortClasses, sortOn, type DiameterColumn } from '@/diameterClasses'
import { formatOneDecimal } from '@/keyFigures'
import { processedStemsLink } from '@/stemlist'

/**
 * The dashboard section "Stämme nach Mittendurchmesser": a table that sorts on every column. The row without diameter ("Kein ⌀") stays last.
 * Narrow, each row stacks: diameter and stems, the yield bar, then the beams per stem with their names.
 * The arrow at the end of a row, and with it the whole row, opens the list of stems with exactly the stems the row counts (processed, this class).
 */
const props = defineProps<{ section: DashboardDiameterSection }>()

// `note` stands on a second line in the header, muted
const COLUMNS: { id: DiameterColumn; label: string; note?: string; right?: true }[] = [
  { id: 'diameter', label: 'Durchmesser' },
  { id: 'yield', label: 'Ausbeute' },
  { id: 'stems', label: 'Stämme', note: '(nicht sägbar)', right: true },
  { id: 'beams_per_stem_large', label: 'Balken 14×14', note: 'je Stamm', right: true },
  { id: 'beams_per_stem_small', label: 'Balken 10×14', note: 'je Stamm', right: true },
]

// The whole row is the link: the link of the arrow stretches over it (the row is its positioning box), so there is one real link per row
// (keyboard, screen reader, "open in a new tab") and no click handler. Hover and keyboard focus tint the row alike.
const linkedRow = 'cursor-pointer hover:bg-well has-focus-visible:bg-well'
// The arrow is only the hint (its column is narrow, 24 px of air before it); the 44 px target is the row
const rowLink =
  'flex size-5 items-center justify-center rounded-md text-ink after:absolute after:inset-0'

const notesOpen = ref(false)
const sort = ref(DEFAULT_DIAMETER_SORT)
const rows = computed(() => sortClasses(props.section.rows, sort.value))
const stemsText = (stems: number) => `${stems} ${stems === 1 ? 'Stamm' : 'Stämme'}`
const percent = (share: number) => `${formatOneDecimal(share * 100)}\u00a0%`
</script>

<template>
  <section :aria-labelledby="`section-${section.key}`">
    <!-- The section heading above the card, styled as the card sections; the button stands beside it, not in it: the heading keeps its name.
         -my-2.5 keeps the 44 px target from making the row higher than the heading alone -->
    <div class="flex items-center">
      <h2 :id="`section-${section.key}`" class="text-label font-bold">{{ section.label }}</h2>
      <InfoPopover
        v-model:open="notesOpen"
        :button-label="`Erklärung zeigen: ${section.label}`"
        wide
        class="-my-2.5"
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
    <div class="mt-4 card p-4 sm:p-6">
      <!-- Same swatches as the bar: dark = sawn timber, light = the rest of the stem -->
      <ul class="flex flex-wrap gap-x-4 text-sm text-mute">
        <li class="flex items-center gap-2">
          <span class="size-3 rounded-xs bg-ink" aria-hidden="true" />Schnittholz
        </li>
        <li class="flex items-center gap-2">
          <span class="size-3 rounded-xs bg-line" aria-hidden="true" />Verschnitt (Rinde, Schwarten,
          Späne)
        </li>
      </ul>
      <table class="mt-4 w-full text-detail tabular-nums max-md:block md:table-fixed">
        <colgroup>
          <col class="w-28" />
          <col />
          <col class="w-28" />
          <col class="w-28" />
          <col class="w-28" />
          <col class="w-11" />
        </colgroup>
        <thead class="max-md:block">
          <tr class="max-md:flex max-md:flex-wrap max-md:gap-x-4">
            <th
              v-for="column in COLUMNS"
              :key="column.id"
              scope="col"
              :class="
                column.right ? 'md:pl-1 md:text-right md:align-bottom' : 'text-left md:align-bottom'
              "
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
                class="flex min-h-11 items-end pb-1 text-caption hover:underline"
                :class="[
                  column.id === sort.column ? 'font-bold text-ink' : 'font-semibold text-mute',
                  column.right ? 'md:justify-end md:text-right' : 'text-left',
                ]"
                @click="sort = sortOn(sort, column.id)"
              >
                <span class="whitespace-nowrap" :class="column.right ? 'text-right' : 'text-left'"
                  >{{ column.label
                  }}<template v-if="column.note"
                    >{{ ' '
                    }}<span class="block font-normal whitespace-nowrap text-mute">{{
                      column.note
                    }}</span></template
                  ></span
                ><component
                  :is="
                    column.id !== sort.column
                      ? ChevronsUpDownIcon
                      : sort.dir === 'desc'
                        ? ArrowDownWideNarrowIcon
                        : ArrowUpNarrowWideIcon
                  "
                  :size="column.id === sort.column ? 20 : 16"
                  :stroke-width="column.id === sort.column ? 2.5 : 2"
                  class="ml-1 shrink-0 self-end"
                  :class="column.id === sort.column ? 'text-ink' : 'mb-0.5 text-faint'"
                  aria-hidden="true"
                />
              </button>
            </th>
            <th scope="col" class="max-md:hidden"><span class="sr-only">Stammliste</span></th>
          </tr>
        </thead>
        <tbody class="max-md:block">
          <!-- Narrow, a row is a grid: diameter | count, the bar across, then one figure per line -->
          <tr
            v-for="row in rows"
            :key="row.from_cm"
            :class="row.stems ? linkedRow : undefined"
            class="relative border-t border-soft max-md:grid max-md:grid-cols-[1fr_auto_auto] max-md:gap-x-4 max-md:gap-y-1 max-md:py-3"
          >
            <th scope="row" class="py-3 text-left font-normal max-md:py-0">
              <!-- Whole cm: the class 32 to 34 holds 32 and 33 cm -->
              {{ formatDiameterClass(row.from_cm) }}
            </th>
            <td class="py-3 max-md:col-span-3 max-md:row-start-2 max-md:py-1">
              <span v-if="row.yield === null" role="img" aria-label="kein gesägter Stamm">
                <span class="text-mute md:hidden">Ausbeute </span>–
              </span>
              <span v-else class="flex items-center gap-3">
                <!-- Light background = the rest, dark part = the yield -->
                <span
                  role="img"
                  :aria-label="`Ausbeute ${percent(row.yield)}`"
                  class="block h-[18px] min-w-0 flex-1 overflow-hidden rounded bg-line"
                >
                  <span class="block h-full bg-ink" :style="{ width: `${row.yield * 100}%` }" />
                </span>
                <span class="w-16 text-right">{{ percent(row.yield) }}</span>
              </span>
            </td>
            <td
              class="py-3 pl-6 text-right max-md:col-start-2 max-md:row-start-1 max-md:py-0 max-md:pl-0"
            >
              <!-- The count ends at a fixed place, so that the counts stand below each other whether or not a bracket follows -->
              <span
                role="img"
                :aria-label="
                  row.not_sawable
                    ? `${stemsText(row.stems)}, davon ${row.not_sawable} nicht sägbar`
                    : stemsText(row.stems)
                "
              >
                <span class="max-md:hidden"
                  >{{ row.stems
                  }}<span class="inline-block w-10 text-left text-mute">{{
                    row.not_sawable ? `(${row.not_sawable})` : ''
                  }}</span></span
                >{{ ' ' }}
                <!-- Stacked there is no header: the words stand in the row -->
                <span class="md:hidden"
                  >{{ stemsText(row.stems)
                  }}<template v-if="row.not_sawable">
                    ({{ row.not_sawable }} nicht sägbar)</template
                  ></span
                >
              </span>
            </td>
            <td class="py-3 pl-3 text-right max-md:col-span-3 max-md:py-0 max-md:text-left">
              <span class="text-mute md:hidden">14×14 je Stamm </span>
              <span
                v-if="row.beams_per_stem_large === null"
                role="img"
                aria-label="kein gesägter Stamm"
                >–</span
              >
              <template v-else>{{ formatOneDecimal(row.beams_per_stem_large) }}</template>
            </td>
            <td class="py-3 pl-3 text-right max-md:col-span-3 max-md:py-0 max-md:text-left">
              <span class="text-mute md:hidden">10×14 je Stamm </span>
              <span
                v-if="row.beams_per_stem_small === null"
                role="img"
                aria-label="kein gesägter Stamm"
                >–</span
              >
              <template v-else>{{ formatOneDecimal(row.beams_per_stem_small) }}</template>
            </td>
            <!-- The link of the row (stretched over it, see rowLink). Narrow, the arrow stands top right beside the count; its width stays when there is no arrow, so the counts line up. -->
            <td class="p-0 pl-6 max-md:col-start-3 max-md:row-start-1 max-md:w-5 max-md:pl-0">
              <RouterLink
                v-if="row.stems"
                :to="{ name: 'stems', query: processedStemsLink(row.from_cm) }"
                :aria-label="`Stämme ${formatDiameterClass(row.from_cm)} in der Stammliste zeigen`"
                :class="rowLink"
              >
                <ArrowRightIcon :size="16" aria-hidden="true" />
              </RouterLink>
            </td>
          </tr>
          <tr
            v-if="section.without_diameter"
            :class="linkedRow"
            class="relative border-t border-soft max-md:grid max-md:grid-cols-[1fr_auto_auto] max-md:gap-x-4 max-md:gap-y-1 max-md:py-3"
          >
            <!-- ⌀ keeps the row on one line; the screen reader gets the word -->
            <th
              scope="row"
              aria-label="Kein Durchmesser"
              class="py-3 text-left font-normal max-md:py-0"
            >
              Kein ⌀
            </th>
            <!-- No class, so no yield: no bar, and nothing in its place -->
            <td class="max-md:hidden" />
            <td
              class="py-3 pl-6 text-right max-md:col-start-2 max-md:row-start-1 max-md:py-0 max-md:pl-0"
            >
              <span class="max-md:hidden"
                >{{ section.without_diameter }}<span class="inline-block w-10"
              /></span>
              <span class="md:hidden">{{ stemsText(section.without_diameter) }}</span>
            </td>
            <!-- The other figures are not worked out without a class -->
            <td class="max-md:hidden" />
            <td class="max-md:hidden" />
            <td class="p-0 pl-6 max-md:col-start-3 max-md:row-start-1 max-md:w-5 max-md:pl-0">
              <RouterLink
                :to="{ name: 'stems', query: processedStemsLink(null) }"
                aria-label="Stämme ohne Durchmesser in der Stammliste zeigen"
                :class="rowLink"
              >
                <ArrowRightIcon :size="16" aria-hidden="true" />
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
