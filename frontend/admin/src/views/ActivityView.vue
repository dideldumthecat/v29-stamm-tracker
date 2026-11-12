<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { ChevronDownIcon, TreesIcon, XIcon } from '@lucide/vue'
import type { ActivityEntry, ActivityResponse } from '@v29/shared/contract'
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import { entriesText, groupByDay } from '@/activity'
import { ApiError, request } from '@/api/client'
import ActivityEntryCard from '@/components/ActivityEntry.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import StatusCard from '@/components/StatusCard.vue'
import { useTagsField } from '@/tagsField'

const route = useRoute()
const router = useRouter()

// The URL is the filter: shareable, and the back button steps through the filters.
const FILTERS = ['from', 'to', 'user', 'tags'] as const
const filter = computed(() =>
  Object.fromEntries(FILTERS.map((name) => [name, String(route.query[name] ?? '')])),
)
function setFilter(name: (typeof FILTERS)[number], value: string, replace = false) {
  // Only the known filters are carried over: anything else in an old link is dropped with the next change.
  const query: LocationQueryRaw = { ...filter.value, [name]: value.trim() }
  for (const key of FILTERS) if (!query[key]) delete query[key]
  void (replace ? router.replace({ query }) : router.push({ query }))
}

const tagsField = useTemplateRef<HTMLInputElement>('tagsField')
const { tagsInput, onTagsInput, applyTagsNow, clearTags, resetTagsInput } = useTagsField({
  current: () => filter.value.tags,
  apply: (tags, replace) => setFilter('tags', tags, replace),
  field: tagsField,
})

// A set filter (per the URL) turns white with a black border; an empty one stays on the grey page, and focus makes it white while typing.
function fieldClass(name: (typeof FILTERS)[number]) {
  return [
    'mt-1 h-11 rounded-lg border-2 px-3 text-base text-ink placeholder:text-dim focus:bg-paper',
    filter.value[name] ? 'border-ink bg-paper' : 'border-dim bg-transparent',
  ]
}

const hasFilter = computed(() => FILTERS.some((name) => filter.value[name]))
function resetFilter() {
  resetTagsInput()
  void router.push({ query: {} })
}
const fromField = useTemplateRef<HTMLInputElement>('fromField')
function resetFromBar() {
  resetFilter()
  fromField.value?.focus()
}

const entries = ref<ActivityEntry[]>([])
const totals = ref<ActivityResponse['totals'] | null>(null)
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

async function load() {
  const mine = ++latest
  status.value = 'loading'
  try {
    const response = await request<ActivityResponse>('GET', url())
    if (mine !== latest) return
    entries.value = response.entries
    totals.value = response.totals
    users.value = response.users
    cursor.value = response.next_cursor
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
    const response = await request<ActivityResponse>('GET', url(cursor.value!))
    if (mine !== latest) return
    entries.value = [...entries.value, ...response.entries]
    cursor.value = response.next_cursor
  } catch {
    if (mine === latest) moreFailed.value = true
  } finally {
    loadingMore.value = false
  }
}

watch(() => route.query, load, { immediate: true })

const days = computed(() => groupByDay(entries.value))
// TODO: "Gefilterte Liste exportieren" (see the design) once the administration has an export.
</script>

<template>
  <main class="page-column py-8">
    <h1 class="text-3xl font-bold">Aktivität</h1>
    <p class="mt-2 text-measure text-mute">
      Wer hat wann was erfasst? Die Uhrzeit links ist der Eingang am Server (nach einem Sync), die
      Zeiten in den Details sind die Uhrzeit am Handy zum Zeitpunkt der Erfassung.
    </p>

    <form class="mt-6 flex flex-wrap items-end gap-x-4 gap-y-3" @submit.prevent>
      <label class="flex flex-col text-sm text-mute">
        Von
        <input
          ref="fromField"
          type="date"
          :class="fieldClass('from')"
          :value="filter.from"
          @change="setFilter('from', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex flex-col text-sm text-mute">
        Bis
        <input
          type="date"
          :class="fieldClass('to')"
          :value="filter.to"
          @change="setFilter('to', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex flex-col text-sm text-mute">
        Person
        <span class="relative flex">
          <select
            class="w-full appearance-none pr-10"
            :class="fieldClass('user')"
            :value="filter.user"
            @change="setFilter('user', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Alle</option>
            <!-- :selected, because the options arrive after the URL has already set the value -->
            <option
              v-for="person in users"
              :key="person.id"
              :value="person.id"
              :selected="person.id === filter.user"
            >
              {{ person.name }}
            </option>
          </select>
          <ChevronDownIcon
            :size="18"
            class="pointer-events-none absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-ink"
            aria-hidden="true"
          />
        </span>
      </label>
      <div class="flex min-w-48 flex-1 flex-col text-sm text-mute">
        <label for="activity-tags">Kennung</label>
        <span class="relative flex">
          <input
            id="activity-tags"
            ref="tagsField"
            v-model="tagsInput"
            type="text"
            inputmode="text"
            autocomplete="off"
            placeholder="z. B. 104 oder 100-120"
            class="w-full pr-11"
            :class="fieldClass('tags')"
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
      <!-- Always shown; without a filter it is natively disabled (greyed out, not tabbable, announced as unavailable) -->
      <button
        type="button"
        class="flex h-11 items-center gap-2 rounded-lg px-2 text-base whitespace-nowrap text-ink underline enabled:active:bg-ink enabled:active:text-paper disabled:text-dim disabled:no-underline"
        :disabled="!hasFilter"
        @click="resetFromBar"
      >
        <XIcon :size="18" aria-hidden="true" />
        Filter zurücksetzen
      </button>
    </form>

    <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />

    <StatusCard
      v-else-if="status === 'loading'"
      title="Moment"
      text-class="max-w-[32ch]"
      role="status"
    >
      <template #icon>
        <SawBladeIcon :size="96" :stroke-width="1.5" spinning class="text-ink" aria-hidden="true" />
      </template>
      <template #text>Ergebnis wird zurechtgesägt</template>
    </StatusCard>

    <StatusCard
      v-else-if="!entries.length"
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

    <template v-else>
      <p v-if="totals" class="mt-6 text-lg font-bold">{{ entriesText(totals.entries) }}</p>

      <section
        v-for="day in days"
        :key="day.key"
        class="mt-4 card px-4 sm:px-6"
        :aria-labelledby="`day-${day.key}`"
      >
        <h2 :id="`day-${day.key}`" class="border-b-2 border-ink pt-4 pb-2 text-lg font-bold">
          {{ day.heading }}
        </h2>
        <div class="divide-y divide-soft">
          <ActivityEntryCard v-for="entry in day.entries" :key="entry.id" :entry="entry" />
        </div>
      </section>

      <div v-if="cursor" class="mt-6 flex items-center gap-3">
        <p v-if="moreFailed" class="text-sm font-semibold" role="alert">Laden fehlgeschlagen.</p>
        <button
          type="button"
          class="h-11 rounded-lg border-2 border-ink bg-paper px-4 font-bold disabled:text-mute"
          :disabled="loadingMore"
          @click="loadMore"
        >
          Ältere laden
        </button>
      </div>
    </template>
  </main>
</template>
