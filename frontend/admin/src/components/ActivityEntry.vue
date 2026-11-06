<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import type { ActivityEntry } from '@v29/shared/contract'
import FormattedTag from '@v29/shared/FormattedTag.vue'

import { detailRows, eventsText, formatTime, recordedRange, summarize } from '@/activity'

const props = defineProps<{ entry: ActivityEntry }>()

const lines = computed(() => summarize(props.entry))
const items = computed(() => props.entry.items.map((item) => ({ ...item, rows: detailRows(item) })))
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
        <p>
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
        <div class="mt-3 overflow-x-auto rounded-lg border border-line">
          <table class="w-full min-w-96 text-left text-sm">
            <!-- Only for screen readers: the columns explain themselves. -->
            <thead class="sr-only">
              <tr>
                <th scope="col">Kennung</th>
                <th scope="col">Merkmal</th>
                <th scope="col">Wert</th>
              </tr>
            </thead>
            <!-- One <tbody> per stem or beam: its tag spans its rows, the line below it is the stronger one. -->
            <!-- TODO: a RouterLink to the detail page once it exists; the tag is the only place to change. -->
            <tbody
              v-for="item in items"
              :key="item.label"
              class="border-b border-line last:border-b-0"
            >
              <tr
                v-for="(row, index) in item.rows"
                :key="index"
                class="border-b border-soft align-top last:border-b-0"
              >
                <th
                  v-if="index === 0"
                  scope="row"
                  :rowspan="item.rows.length"
                  class="px-3 py-2 text-left text-base leading-5 font-semibold tracking-[.05em] tabular-nums"
                >
                  <FormattedTag v-if="hasNumber(item.label)" :tag-number="item.label" />
                  <template v-else>{{ item.label }}</template>
                </th>
                <td class="px-3 py-2 text-mute">{{ row.name }}</td>
                <td class="px-3 py-2 break-words text-ink">{{ row.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  </article>
</template>
