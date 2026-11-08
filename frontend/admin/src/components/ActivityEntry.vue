<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import type { ActivityEntry } from '@v29/shared/contract'
import FormattedTag from '@v29/shared/FormattedTag.vue'

import { detailRows, eventsText, formatTime, recordedRange, summarize } from '@/activity'

const props = defineProps<{ entry: ActivityEntry }>()

const lines = computed(() => summarize(props.entry))
// Newest first by the first change of each item; equal times keep the order of the contract (sort is stable).
const items = computed(() =>
  props.entry.items
    .map((item) => ({ ...item, rows: detailRows(item) }))
    .sort((a, b) => Date.parse(b.changes[0].recorded_at) - Date.parse(a.changes[0].recorded_at)),
)
// "ohne Kennung" has no number to pad
const hasNumber = (label: string) => /^\d/.test(label)
</script>

<template>
  <!-- From md on two equal halves (time, person and bullet points | details); below, the details sit under the bullet points. -->
  <article class="py-5 md:grid md:grid-cols-2 md:gap-x-8">
    <div class="grid grid-cols-[3.5rem_1fr] gap-x-3 sm:grid-cols-[4.5rem_1fr]">
      <time class="font-bold tabular-nums" :datetime="entry.received_at">{{
        formatTime(entry.received_at)
      }}</time>
      <div class="text-measure min-w-0">
        <p class="flex flex-wrap items-baseline gap-x-4">
          <span class="font-semibold">{{ entry.user.name }}</span>
          {{ ' ' }}
          <span class="text-sm text-mute tabular-nums"
            >{{ eventsText(entry.event_count) }} · {{ recordedRange(entry) }}</span
          >
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="line in lines" :key="line">{{ line }}</li>
        </ul>
      </div>
    </div>
    <!-- The left padding lines the details up with the text column of the left half while they are stacked. -->
    <div class="mt-3 min-w-0 pl-[4.25rem] sm:pl-[5.25rem] md:mt-0 md:pl-0">
      <details class="group">
        <!-- 24 px high like the line of the person's name, so that the two are level. -->
        <summary
          class="flex h-6 w-fit cursor-pointer list-none items-center gap-1 text-base md:mx-auto [&::-webkit-details-marker]:hidden"
        >
          <span class="underline group-open:hidden">Details anzeigen</span>
          <span class="hidden underline group-open:inline">Details ausblenden</span>
          <ChevronDownIcon
            :size="20"
            class="group-open:rotate-180 motion-safe:transition-transform"
            aria-hidden="true"
          />
        </summary>
        <!-- One table per stem or beam: the <caption> (tag left, time right) sits above the bordered card and names the table for screen readers. -->
        <!-- TODO: a RouterLink to the detail page once it exists; the tag is the only place to change. -->
        <!-- border-separate: with Tailwind's default collapsed borders a table ignores border-radius. -->
        <!-- --pad: the inner padding of the card, shared by the cells and the caption (which sits outside the 1 px border). -->
        <div class="mt-3 space-y-6 [--pad:--spacing(4)]">
          <table
            v-for="item in items"
            :key="item.label"
            class="w-full border-separate border-spacing-0 card text-left"
          >
            <caption class="px-[calc(var(--pad)+1px)] pb-1.5">
              <div class="flex items-baseline justify-between gap-x-3">
                <span class="font-semibold tracking-[.05em] tabular-nums">
                  <FormattedTag v-if="hasNumber(item.label)" :tag-number="item.label" />
                  <template v-else>{{ item.label }}</template>
                </span>
                <!-- Device time of the item's first change: why the items are not sorted by tag. -->
                <time class="text-mute tabular-nums" :datetime="item.changes[0].recorded_at">{{
                  formatTime(item.changes[0].recorded_at)
                }}</time>
              </div>
            </caption>
            <!-- Only for screen readers: the columns explain themselves. -->
            <thead class="sr-only">
              <tr>
                <th scope="col">Merkmal</th>
                <th scope="col">Wert</th>
              </tr>
            </thead>
            <!-- No lines between the rows: the gap between rows (16 px) is clearly larger than the one between wrapped lines (22 px line height). -->
            <tbody>
              <tr v-for="(row, index) in item.rows" :key="index" class="align-top leading-snug">
                <!-- From md on as wide as the longest name and never wrapped; below, names may wrap instead of scrolling. -->
                <th
                  scope="row"
                  class="w-2/5 py-2 pr-3 pl-(--pad) text-left font-normal text-mute md:w-px md:whitespace-nowrap"
                >
                  {{ row.name }}
                </th>
                <td class="py-2 pr-(--pad) wrap-anywhere text-ink">{{ row.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  </article>
</template>
