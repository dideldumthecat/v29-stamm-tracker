<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { ChevronDownIcon, LoaderCircleIcon, TreesIcon, XIcon } from '@lucide/vue'
import type { ActivityEntry, ActivityResponse } from '@v29/shared/contract'
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import { completeDays, describePeriod, entriesText, groupByDay } from '@/activity'
import { ApiError, request } from '@/api/client'
import ActivityEntryCard from '@/components/ActivityEntry.vue'
import FilterButton from '@/components/FilterButton.vue'
import FilterChecklist from '@/components/FilterChecklist.vue'
import FilterRange from '@/components/FilterRange.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import StatusCard from '@/components/StatusCard.vue'
import { useFilterBar } from '@/filterBar'
import { describePicks, type ColumnFilter, type FilterChip } from '@/listFilters'
import { useTagsField } from '@/tagsField'

const route = useRoute()
const router = useRouter()

// The URL is the filter: shareable, and the back button steps through the filters.
const FILTERS = ['from', 'to', 'user', 'tags'] as const
const filter = computed(() =>
  Object.fromEntries(FILTERS.map((name) => [name, String(route.query[name] ?? '')])),
)
function setFilters(changes: Partial<Record<(typeof FILTERS)[number], string>>, replace = false) {
  // Only the known filters are carried over: anything else in an old link is dropped with the next change.
  const query: LocationQueryRaw = { ...filter.value, ...changes }
  for (const key of FILTERS) {
    query[key] = String(query[key] ?? '').trim()
    if (!query[key]) delete query[key]
  }
  return replace ? router.replace({ query }) : router.push({ query })
}

const tagsField = useTemplateRef<HTMLInputElement>('tagsField')
const { tagsInput, onTagsInput, applyTagsNow, clearTags, resetTagsInput } = useTagsField({
  current: () => filter.value.tags,
  apply: (tags, replace) => setFilters({ tags }, replace),
  field: tagsField,
})

const hasFilter = computed(() => FILTERS.some((name) => filter.value[name]))
function resetFilter() {
  resetTagsInput()
  void router.push({ query: {} })
}
function resetFromBar() {
  resetFilter()
  tagsField.value?.focus()
}

// The period is one filter of two URL values; the pop-up works with a range of days like the lists of stems.
const period = computed<ColumnFilter | null>(() =>
  filter.value.from || filter.value.to
    ? { kind: 'range', from: filter.value.from, to: filter.value.to }
    : null,
)
function setPeriod(next: ColumnFilter | null, replace: boolean) {
  const range = next?.kind === 'range' ? next : { from: '', to: '' }
  void setFilters({ from: range.from, to: range.to }, replace)
}
// The people are one filter of one URL value, the ids joined by commas
const people = computed(() => filter.value.user.split(',').filter(Boolean))
const personOptions = computed(() =>
  users.value.map((person) => ({ id: person.id, label: person.name })),
)

// The chips come with the list (the names of the people come with the response)
const chips = computed<FilterChip[]>(() => {
  const names = personOptions.value
    .filter((option) => people.value.includes(option.id))
    .map((option) => option.label)
  return [
    ...(filter.value.tags
      ? [{ id: 'tags', name: 'Kennung', text: `Kennung: ${filter.value.tags}` }]
      : []),
    ...(period.value
      ? [
          {
            id: 'range',
            name: 'Zeitraum',
            text: `Zeitraum: ${describePeriod(filter.value.from, filter.value.to)}`,
          },
        ]
      : []),
    ...(names.length
      ? [
          {
            id: 'user',
            name: 'Person',
            text: `Person: ${describePicks(names, people.value.length)}`,
          },
        ]
      : []),
  ]
})
const { openId, setOpen, openFilter, focusAfterRemove, settle } = useFilterBar(tagsField)
async function removeFilter(id: string) {
  const ids = chips.value.map((chip) => chip.id)
  if (id === 'tags') {
    resetTagsInput()
    await setFilters({ tags: '' })
  } else await setFilters(id === 'range' ? { from: '', to: '' } : { user: '' })
  // The list is gone while the new result loads
  focusAfterRemove(ids, id, true)
}

const entries = ref<ActivityEntry[]>([])
const totals = ref<ActivityResponse['totals'] | null>(null)
// The last count of all entries the server gave; null until it has: then the bar has the chips but no count
const entriesUnfiltered = ref<number | null>(null)
const users = ref<ActivityResponse['users']>([])
const cursor = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref<number>(0)
const loadingMore = ref(false)
const moreFailed = ref(false)
// Answers of a filter the user has already left must not overwrite the current one.
let latest = 0

function url(before?: string) {
  const query = new URLSearchParams()
  for (const name of FILTERS) if (filter.value[name]) query.set(name, filter.value[name])
  if (before) query.set('before', before)
  return `admin/activity?${query}`
}

// Only complete days are shown (see completeDays), so a click or a filter may need several pages.
const days = computed(() => completeDays(groupByDay(entries.value), cursor.value !== null))

/** Fetches pages until more days than `shown` can be shown, or the server has no more. Each page is kept as it arrives. */
async function fetchDays(mine: number, shown: number) {
  while (cursor.value && days.value.length <= shown) {
    const response = await request<ActivityResponse>('GET', url(cursor.value))
    if (mine !== latest) return
    entries.value = [...entries.value, ...response.entries]
    // An empty page ends the loop, whatever the cursor says: a server that never runs dry must not keep us fetching.
    cursor.value = response.entries.length ? response.next_cursor : null
  }
}

async function load() {
  const mine = ++latest
  status.value = 'loading'
  moreFailed.value = false
  try {
    const response = await request<ActivityResponse>('GET', url())
    if (mine !== latest) return
    entries.value = response.entries
    totals.value = response.totals
    entriesUnfiltered.value = response.entries_unfiltered
    users.value = response.users
    cursor.value = response.next_cursor
    await fetchDays(mine, 0)
    if (mine !== latest) return
    status.value = 'ready'
  } catch (error) {
    if (mine !== latest) return
    failure.value = error instanceof ApiError ? error.status : 0
    if (failure.value === 400) {
      // The server cannot read the filter: for the user that is an empty result, not a fault
      entries.value = []
      totals.value = null
      cursor.value = null
      status.value = 'ready'
    } else {
      status.value = 'error'
    }
  }
}

async function loadMore() {
  const mine = latest
  loadingMore.value = true
  moreFailed.value = false
  try {
    await fetchDays(mine, days.value.length)
  } catch {
    if (mine === latest) moreFailed.value = true
  } finally {
    loadingMore.value = false
  }
}

watch(() => route.query, load, { immediate: true })
watch(status, (now) => now === 'ready' && void nextTick(settle))

const showList = computed(() => status.value === 'ready' && entries.value.length > 0)
// The bar stays with "Waldesruh" as long as a filter is set, so that its chips show what caused it
const showBar = computed(() => status.value === 'ready' && (showList.value || hasFilter.value))
const barText = computed(() =>
  entriesUnfiltered.value === null
    ? ''
    : entriesText(totals.value?.entries ?? 0, entriesUnfiltered.value, hasFilter.value),
)
// TODO: "Gefilterte Liste exportieren" (see the design) once the administration has an export.
</script>

<template>
  <main class="py-8">
    <div class="page-column" :class="{ 'pb-2': showBar }">
      <h1 class="text-3xl font-bold">Aktivität</h1>
      <p class="mt-2 text-measure text-mute">
        Wer hat wann was erfasst? Die Uhrzeit links ist der Eingang am Server (nach einem Sync), die
        Zeiten in den Details sind die Uhrzeit am Handy zum Zeitpunkt der Erfassung.
      </p>

      <form class="mt-6" @submit.prevent>
        <div class="flex flex-wrap items-end gap-x-3 gap-y-3">
          <div class="flex max-w-sm min-w-48 flex-1 flex-col text-sm text-mute">
            <label for="activity-tags">Kennung</label>
            <span class="relative flex">
              <input
                id="activity-tags"
                ref="tagsField"
                v-model="tagsInput"
                type="text"
                inputmode="text"
                autocomplete="off"
                placeholder="z. B. 104, 100-120 oder 104-A"
                class="mt-1 h-11 w-full rounded-lg border-2 px-3 pr-11 text-base text-ink placeholder:text-dim focus:bg-paper"
                :class="filter.tags ? 'border-ink bg-paper' : 'border-dim bg-transparent'"
                @input="onTagsInput"
                @keydown.enter="applyTagsNow"
                @change="applyTagsNow"
              />
              <!-- 44 x 44 px like the field is high: the touch target reaches over the border; mousedown.prevent keeps the focus in the field,
               so leaving it does not apply the half-typed text before the click clears it -->
              <button
                v-if="tagsInput"
                type="button"
                class="absolute top-1 right-0 flex size-11 items-center justify-center rounded-lg text-ink active:bg-ink active:text-paper"
                aria-label="Kennung leeren"
                @mousedown.prevent
                @click="clearTags"
              >
                <XIcon :size="18" aria-hidden="true" />
              </button>
            </span>
          </div>
          <FilterButton
            id="range"
            name="Zeitraum"
            :active="!!period"
            :open="openId === 'range'"
            @update:open="setOpen('range', $event)"
          >
            <FilterRange type="date" :filter="period" @change="setPeriod" />
          </FilterButton>
          <FilterButton
            id="user"
            name="Person"
            :active="!!filter.user"
            :count="people.length || undefined"
            :open="openId === 'user'"
            @update:open="setOpen('user', $event)"
          >
            <FilterChecklist
              :options="personOptions"
              :picks="people"
              without-none
              @change="(picks) => setFilters({ user: picks.join(',') })"
            />
          </FilterButton>
        </div>
        <!-- On a row of its own at the right edge of the column. Always shown; without a filter it is natively disabled
             (greyed out, not tabbable, announced as unavailable) -->
        <div class="mt-3 flex justify-end">
          <button
            type="button"
            class="flex h-11 items-center gap-2 rounded-lg px-2 text-base whitespace-nowrap text-ink underline enabled:active:bg-ink enabled:active:text-paper disabled:text-dim disabled:no-underline"
            :disabled="!hasFilter"
            @click="resetFromBar"
          >
            <XIcon :size="18" aria-hidden="true" />
            Filter zurücksetzen
          </button>
        </div>
      </form>
    </div>

    <!-- The 8 px below the filter block (pb-2, not a margin on the sticky bar, which would stick 8 px too low) and the bar's min-h-15 keep the text 24 px
         under the filter, and the first card 16 px under the text, as without the bar. -->
    <ResultsBar
      v-if="showBar"
      :text="barText"
      :chips="chips"
      @open="openFilter"
      @remove="removeFilter"
    />

    <div class="page-column">
      <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />

      <StatusCard
        v-else-if="status === 'loading'"
        title="Moment"
        text-class="max-w-[32ch]"
        role="status"
      >
        <template #icon>
          <SawBladeIcon
            :size="96"
            :stroke-width="1.5"
            spinning
            class="text-ink"
            aria-hidden="true"
          />
        </template>
        <template #text>Ergebnis wird zurechtgesägt</template>
      </StatusCard>

      <StatusCard
        v-else-if="status === 'ready' && !entries.length"
        title="Waldesruh"
        text-class="md:whitespace-nowrap"
        role="status"
      >
        <template #icon>
          <TreesIcon :size="96" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
        </template>
        <!-- Not broken up on wide screens; on a phone it has to wrap. -->
        <template #text> Keine Ergebnisse weit und breit gefunden. </template>
        <button
          v-if="hasFilter"
          type="button"
          class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
          @click="resetFilter"
        >
          Filter zurücksetzen
        </button>
      </StatusCard>

      <template v-if="showList">
        <section
          v-for="day in days"
          :key="day.key"
          class="mt-4 card px-4 first:mt-0 sm:px-6"
          :aria-labelledby="`day-${day.key}`"
        >
          <h2 :id="`day-${day.key}`" class="border-b-2 border-ink pt-4 pb-2 text-lg font-bold">
            {{ day.heading }}
          </h2>
          <div class="divide-y divide-soft">
            <ActivityEntryCard v-for="entry in day.entries" :key="entry.id" :entry="entry" />
          </div>
        </section>

        <div v-if="cursor" class="mt-6 flex flex-col items-center gap-3">
          <p v-if="moreFailed" class="text-sm font-semibold" role="alert">Laden fehlgeschlagen.</p>
          <button
            type="button"
            class="flex h-11 items-center gap-2 rounded-lg border-2 border-ink bg-paper px-4 font-bold disabled:text-mute"
            :disabled="loadingMore"
            @click="loadMore"
          >
            <!-- Same size as the chevron, so the button keeps its width while loading -->
            <LoaderCircleIcon
              v-if="loadingMore"
              :size="18"
              class="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <ChevronDownIcon v-else :size="18" aria-hidden="true" />
            Ältere laden
          </button>
        </div>
      </template>
    </div>
  </main>
</template>
