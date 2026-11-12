<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDownIcon, CornerLeftUpIcon, TreesIcon, BugIcon } from '@lucide/vue'
import { beamSummary } from '@v29/shared/attributes'
import type { ActivityEntry, ActivityResponse, Snapshot } from '@v29/shared/contract'
import BeamRowLabel from '@v29/shared/BeamRowLabel.vue'
import FormattedTag from '@v29/shared/FormattedTag.vue'
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import { formatDateTime, formatDayMonth, formatDayMonthTime, formatTime, yearOf } from '@/activity'
import { ApiError, request } from '@/api/client'
import BackLink from '@/components/BackLink.vue'
import ItemPhotos from '@/components/ItemPhotos.vue'
import KeyValueRows from '@/components/KeyValueRows.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import StatusCard from '@/components/StatusCard.vue'
import {
  beamsOf,
  historyPoints,
  normalizeTag,
  splitValues,
  stemNumber,
  timelineRows,
} from '@/detail'

const route = useRoute()

const tag = computed(() => normalizeTag(String(route.params.tag)))

const status = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const failure = ref(0)
const snapshot = ref<Snapshot | null>(null)
// Answers of an item the user has already left must not overwrite the current one.
let latest = 0

async function load() {
  const mine = ++latest
  status.value = 'loading'
  historyEntries.value = null
  if (!tag.value) {
    status.value = 'missing'
    return
  }
  try {
    const response = await request<Snapshot>('GET', 'snapshot')
    if (mine !== latest) return
    snapshot.value = response
    status.value = item.value ? 'ready' : 'missing'
  } catch (error) {
    if (mine !== latest) return
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
    return
  }
  if (status.value === 'ready') void loadHistory(mine)
}

// The history is a card of its own: it loads after the page and fails on its own.
const historyEntries = ref<ActivityEntry[] | null>(null)
const historyFailed = ref(false)
async function loadHistory(mine = latest) {
  historyFailed.value = false
  historyEntries.value = null
  try {
    // The activity of a stem includes its beams; a beam is asked for with the number of its stem and filtered below.
    const entries: ActivityEntry[] = []
    let before: string | null = null
    do {
      const query = new URLSearchParams({ tags: stemNumber(tag.value!) })
      if (before) query.set('before', before)
      const response: ActivityResponse = await request('GET', `admin/activity?${query}`)
      entries.push(...response.entries)
      before = response.next_cursor
    } while (before)
    if (mine === latest) historyEntries.value = entries
  } catch {
    if (mine === latest) historyFailed.value = true
  }
}

const items = computed(() => snapshot.value?.timber_items ?? [])
const item = computed(() => items.value.find((candidate) => candidate.tag_number === tag.value))
const isOwn = (pointItem: { timber_item_id: string }) => pointItem.timber_item_id === item.value?.id
const parent = computed(() =>
  items.value.find((candidate) => candidate.id === item.value?.parent_id),
)
const isBeam = computed(() => tag.value?.includes('-') ?? false)
const kind = computed(() => (isBeam.value ? 'Balken' : 'Stamm'))
const users = computed(() => snapshot.value?.users ?? [])
const attributes = computed(() => snapshot.value?.attributes ?? [])
const userName = (id: string) => users.value.find((user) => user.id === id)?.name ?? 'Unbekannt'

const parts = computed(() => splitValues(item.value!, parent.value, attributes.value, users.value))
const beams = computed(() => (item.value && !isBeam.value ? beamsOf(item.value, items.value) : []))

const points = computed(() => {
  const own = new Set([item.value!.id, ...beams.value.map((beam) => beam.id)])
  return historyPoints(historyEntries.value ?? [], own, item.value!.id)
})

const timeline = computed(() => timelineRows(points.value, new Date().getFullYear()))
const hasYearMarks = computed(() => timeline.value.some((row) => row.year !== undefined))

const card = 'card p-4 sm:p-6'

// Last, so that everything `load` touches exists.
watch(() => route.params.tag, load, { immediate: true })
</script>

<template>
  <!-- Flex column, so the negative margins of the back link do not collapse with the margin of what follows. -->
  <main class="page-column flex flex-col pt-4 pb-8">
    <!-- Without header (loading, error, not found) the link sits above the card. 44 px tap target, but only the text line (24 px)
         takes up space: the rest hangs into the padding and the gap below. With content it is the first element of the header. -->
    <BackLink v-if="status !== 'ready' || !item" class="-my-2.5 self-start" />

    <LoadFailure v-if="status === 'error'" :failure="failure" class="mt-2!" @retry="load" />

    <StatusCard v-else-if="status === 'loading'" title="Moment" role="status" class="mt-2!">
      <template #icon>
        <SawBladeIcon :size="96" :stroke-width="1.5" spinning class="text-ink" aria-hidden="true" />
      </template>
      <template #text>{{ kind }} wird herausgesägt</template>
    </StatusCard>

    <StatusCard
      v-else-if="status === 'missing' || !item"
      title="Waldesruh"
      role="status"
      class="mt-2!"
    >
      <template #icon>
        <TreesIcon :size="96" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
      </template>
      <template #text>{{ kind }} {{ tag ?? route.params.tag }} gibt es nicht (mehr).</template>
    </StatusCard>

    <template v-else>
      <!-- From 900 px on two columns (40/60): the photos stay in view (sticky, spanning both rows) while header and cards scroll on the right.
           Below, one column in the order of the DOM: Kopf, Fotos, Balken, Merkmale, Notizen, Verlauf.
           The header exists once (one heading for screen readers), the grid only moves it. Its 24 px at the sides line the text up with the cards. -->
      <div class="grid items-start gap-6 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <header class="min-w-0 min-[900px]:col-start-2 min-[900px]:row-start-1 min-[900px]:px-6">
          <BackLink class="mb-2 w-fit" />
          <p class="text-[22px] font-bold">{{ isBeam ? 'BALKEN' : 'STAMM' }}</p>
          <h1 class="-mr-[.05em] text-5xl font-extrabold tracking-[.05em] tabular-nums">
            <FormattedTag :tag-number="tag!" />
          </h1>
          <p class="mt-2 text-mute">
            Angelegt {{ formatDateTime(item.created_at) }} von {{ userName(item.created_by) }}
            <template v-if="parts.lastChanged">
              <br />Zuletzt geändert {{ formatDateTime(parts.lastChanged) }} von
              {{ parts.lastChangedBy }}
            </template>
          </p>
          <RouterLink
            v-if="isBeam"
            :to="{ name: 'timber-item', params: { tag: stemNumber(tag!) } }"
            class="mt-2 inline-flex h-11 items-center gap-2 font-semibold"
          >
            <CornerLeftUpIcon :size="20" aria-hidden="true" />
            <span
              >Aus Stamm
              <FormattedTag :tag-number="stemNumber(tag!)" class="underline underline-offset-4"
            /></span>
          </RouterLink>
        </header>

        <!-- Sticky 24 px (like the gap between the cards) under the page header (sticky itself from lg on), otherwise 16 px from the top.
             The maximum height keeps the whole card in the viewport (the main photo shrinks, see ItemPhotos). It also leaves room for what sits below
             the grid at the end of the page (bottom padding of the page and footer, about 7 rem): there the card ends with its grid area,
             and if it were taller it would be pushed up under the page header. -->
        <ItemPhotos
          :key="item.id"
          class="min-[900px]:sticky min-[900px]:top-4 min-[900px]:col-start-1 min-[900px]:row-span-2 min-[900px]:row-start-1 min-[900px]:flex min-[900px]:max-h-[calc(100dvh-1rem-7rem)] min-[900px]:flex-col lg:top-[calc(var(--header-height,0px)+24px)] lg:max-h-[calc(100dvh-var(--header-height,0px)-24px-7rem)]"
          :photos="parts.photos"
          :tag="tag!"
        />

        <div class="flex min-w-0 flex-col gap-6 min-[900px]:col-start-2 min-[900px]:row-start-2">
          <section v-if="beams.length" :class="card" aria-labelledby="beams-heading">
            <h2 id="beams-heading" class="text-lg font-bold">Balken</h2>
            <ul class="mt-2">
              <li v-for="beam in beams" :key="beam.id" class="border-line not-last:border-b">
                <RouterLink
                  :to="{ name: 'timber-item', params: { tag: beam.tag_number } }"
                  class="flex min-h-12 items-center gap-3 py-0.5"
                >
                  <BeamRowLabel
                    :tag-number="beam.tag_number"
                    :summary="beamSummary(beam, item, attributes)"
                  />
                </RouterLink>
              </li>
            </ul>
          </section>

          <section :class="card" aria-labelledby="values-heading">
            <h2 id="values-heading" class="text-lg font-bold">Merkmale</h2>
            <dl class="mt-2 divide-y divide-soft">
              <div
                v-for="row in parts.rows"
                :key="row.id"
                class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 py-3"
              >
                <dt class="text-caption font-semibold wrap-anywhere text-mute">{{ row.name }}</dt>
                <dd class="space-y-2 wrap-anywhere">
                  <span
                    v-if="!row.lines.length"
                    role="img"
                    aria-label="nicht erfasst"
                    class="text-mute"
                    >–</span
                  >
                  <p v-for="(line, index) in row.lines" :key="index" class="leading-snug">
                    {{ line.text }}
                    <span class="block text-caption text-mute">{{ line.source }}</span>
                  </p>
                </dd>
              </div>
            </dl>
          </section>

          <section :class="card" aria-labelledby="notes-heading">
            <h2 id="notes-heading" class="text-lg font-bold">
              Notizen
              <span v-if="!parts.notes.length" role="img" aria-label="keine Notiz" class="text-mute"
                >–</span
              >
            </h2>
            <div v-for="group in parts.notes" :key="group.name" class="mt-3">
              <p v-if="parts.notes.length > 1" class="text-caption font-semibold text-mute">
                {{ group.name }}
              </p>
              <ul class="divide-y divide-soft">
                <li v-for="(entry, index) in group.entries" :key="index" class="py-3">
                  <p class="wrap-anywhere whitespace-pre-line">{{ entry.text }}</p>
                  <p class="text-caption text-mute">{{ entry.source }}</p>
                </li>
              </ul>
            </div>
          </section>

          <div
            v-if="historyFailed"
            :class="[card, 'flex flex-col items-center gap-4 text-center']"
            role="alert"
          >
            <BugIcon :size="40" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
            <p class="leading-message">Der Verlauf konnte nicht geladen werden.</p>
            <button
              type="button"
              class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
              @click="loadHistory()"
            >
              Erneut versuchen
            </button>
          </div>
          <div v-else-if="historyEntries === null" :class="card" role="status">
            <p class="text-lg font-bold">Verlauf</p>
            <p class="text-caption text-mute">wird geladen …</p>
          </div>
          <details v-else class="group card">
            <summary
              class="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-lg font-bold sm:p-6 [&::-webkit-details-marker]:hidden"
            >
              Verlauf
              <ChevronDownIcon
                :size="22"
                class="shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                aria-hidden="true"
              />
            </summary>
            <!-- Timeline by device time: date and time | line with a dot | person and what they changed. Year marks (only if not all points are in the current year) are rows without a dot; the line runs through them. -->
            <ol class="px-4 pb-4 sm:px-6 sm:pb-6">
              <template v-for="(row, index) in timeline" :key="row.key">
                <!-- Hidden from screen readers: the year is read with each point's date instead, so the list stays a list of points. -->
                <li
                  v-if="row.year !== undefined"
                  aria-hidden="true"
                  class="grid grid-cols-[56px_10px_minmax(0,1fr)]"
                >
                  <time
                    class="pb-6 leading-5 font-bold tabular-nums"
                    :datetime="String(row.year)"
                    >{{ row.year }}</time
                  >
                  <div class="relative">
                    <span
                      class="absolute -bottom-2.5 left-1/2 w-0.5 -translate-x-1/2 bg-soft"
                      :class="index === 0 ? 'top-2.5' : 'top-0'"
                    ></span>
                  </div>
                </li>
                <li v-else class="grid grid-cols-[56px_10px_minmax(0,1fr)]">
                  <time
                    class="tabular-nums"
                    :class="index < timeline.length - 1 && 'pb-6'"
                    :datetime="row.point.recordedAt"
                  >
                    <span class="block leading-5 font-bold"
                      >{{ formatDayMonth(row.point.recordedAt)
                      }}<span v-if="hasYearMarks" class="sr-only">{{
                        yearOf(row.point.recordedAt)
                      }}</span></span
                    >
                    <span class="block text-caption text-mute">{{
                      formatTime(row.point.recordedAt)
                    }}</span>
                  </time>
                  <div class="relative" aria-hidden="true">
                    <!-- The line runs from this dot to the next one (10 px = the dot's centre below the top of the row, which the next row's dot has too). The gap between the points is padding of the time and content cells, so this cell spans the whole row.. -->
                    <span
                      v-if="index < timeline.length - 1"
                      class="absolute top-2.5 -bottom-2.5 left-1/2 w-0.5 -translate-x-1/2 bg-soft"
                    ></span>
                    <span class="absolute top-[5px] left-0 size-2.5 rounded-full bg-ink"></span>
                  </div>
                  <div class="min-w-0 pl-5" :class="index < timeline.length - 1 && 'pb-6'">
                    <p :id="`history-${index}`" class="leading-5 font-semibold">
                      {{ row.point.user }}
                    </p>
                    <p v-if="row.point.transferredAt" class="text-caption text-mute tabular-nums">
                      übertragen {{ formatDayMonthTime(row.point.transferredAt) }}
                    </p>
                    <!-- Each block is framed (faint border, no lines between the rows) so that the rows of one point read as a group; name and "übertragen" stay above it. The width (36 rem) makes up for the border and the inner padding, so that the longest attribute name fits on one line; the fixed 2 : 3 columns would otherwise put name and value further apart. -->
                    <KeyValueRows
                      :item="row.point.items.find((pointItem) => isOwn(pointItem))"
                      framed
                      class="mt-2 [--pad:12px] sm:max-w-[36rem]"
                      :labelledby="`history-${index}`"
                    >
                      <!-- A beam shows up in the history of its stem only as created (all else is in its own history). -->
                      <div
                        v-for="beam in row.point.items.filter((pointItem) => !isOwn(pointItem))"
                        :key="beam.timber_item_id"
                        class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 px-[var(--pad,0px)] py-1.5 max-sm:grid-cols-1 max-sm:py-2"
                      >
                        <dt class="text-caption font-semibold wrap-anywhere text-mute">
                          Balken{{ ' ' }}
                          <RouterLink
                            v-if="normalizeTag(beam.label)"
                            :to="{
                              name: 'timber-item',
                              params: { tag: normalizeTag(beam.label)! },
                            }"
                            class="underline"
                            ><FormattedTag :tag-number="beam.label"
                          /></RouterLink>
                          <template v-else>{{ beam.label }}</template>
                        </dt>
                        <dd class="text-sm wrap-anywhere text-ink max-sm:mt-0.5">angelegt</dd>
                      </div>
                    </KeyValueRows>
                  </div>
                </li>
              </template>
            </ol>
          </details>
        </div>
      </div>
    </template>
  </main>
</template>
