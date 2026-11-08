<script setup lang="ts">
import { computed, useId } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import type { ActivityEntry } from '@v29/shared/contract'
import FormattedTag from '@v29/shared/FormattedTag.vue'

import { detailRows, eventsText, formatTime, recordedRange, summarize } from '@/activity'

const props = defineProps<{ entry: ActivityEntry }>()

const uid = useId()
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
  <!-- From md on two equal halves (time, person and bullet points | details); below, the details sit under the bullet points (the cards full width, the toggle indented). -->
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
    <div class="mt-3 min-w-0 md:mt-0">
      <details class="group">
        <!-- 24 px high like the line of the person's name, so that the two are level. While stacked, the left margin lines the toggle up with the text column of the left half; the cards below take the full width. -->
        <summary
          class="ml-[4.25rem] flex h-6 w-fit cursor-pointer list-none items-center gap-1 text-base sm:ml-[5.25rem] md:mx-auto [&::-webkit-details-marker]:hidden"
        >
          <span class="underline group-open:hidden">Details anzeigen</span>
          <span class="hidden underline group-open:inline">Details ausblenden</span>
          <ChevronDownIcon
            :size="20"
            class="group-open:rotate-180 motion-safe:transition-transform"
            aria-hidden="true"
          />
        </summary>
        <!-- One card per stem or beam: a header (tag left, time right) above the table; the header names the table for screen readers. -->
        <!-- TODO: a RouterLink to the detail page once it exists; the tag is the only place to change. -->
        <!-- --pad: the inner padding of the card, shared by the header and the cells so that their texts line up. -->
        <div class="mt-3 space-y-6 [--pad:--spacing(4)]">
          <div v-for="(item, index) in items" :key="item.label" class="card">
            <div
              :id="`${uid}-${index}`"
              class="flex items-baseline justify-between gap-x-3 border-b border-soft px-(--pad) py-2"
            >
              <span class="font-semibold tracking-[.05em] tabular-nums">
                <FormattedTag v-if="hasNumber(item.label)" :tag-number="item.label" />
                <template v-else>{{ item.label }}</template>
              </span>
              <!-- Device time of the item's first change: why the items are not sorted by tag. -->
              <time class="text-mute tabular-nums" :datetime="item.changes[0].recorded_at">{{
                formatTime(item.changes[0].recorded_at)
              }}</time>
            </div>
            <table class="w-full text-left max-md:block" :aria-labelledby="`${uid}-${index}`">
              <!-- Only for screen readers: the columns explain themselves. -->
              <thead class="sr-only">
                <tr>
                  <th scope="col">Merkmal</th>
                  <th scope="col">Wert</th>
                </tr>
              </thead>
              <!-- No lines between the rows: the gap between rows (16 px) is clearly larger than the one between wrapped lines (22 px line height). -->
              <tbody class="max-md:block">
                <tr
                  v-for="(row, rowIndex) in item.rows"
                  :key="rowIndex"
                  class="align-top leading-snug max-md:block max-md:py-2.5"
                >
                  <!-- From md on as wide as the longest name and never wrapped; below, name and value are stacked over the full card width (rows are 20 px apart, name and value 2 px). -->
                  <th
                    scope="row"
                    class="py-2 pr-3 pl-(--pad) text-left font-normal text-mute max-md:block max-md:py-0 max-md:pr-(--pad) md:w-px md:whitespace-nowrap"
                  >
                    {{ row.name }}
                  </th>
                  <td class="py-2 pr-(--pad) wrap-anywhere text-ink max-md:mt-0.5 max-md:block max-md:py-0 max-md:pl-(--pad)">{{ row.value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  </article>
</template>
