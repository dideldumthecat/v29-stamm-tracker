<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { ChevronDownIcon, TreesIcon, XIcon } from '@lucide/vue'
import type { ActivityEntry, ActivityResponse } from '@v29/shared/contract'
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import { entriesText, groupByDay, isReadableTags } from '@/activity'
import { ApiError, request } from '@/api/client'
import ActivityEntryCard from '@/components/ActivityEntry.vue'
import StatusCard from '@/components/StatusCard.vue'

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

// "Kennung" searches while typing. The field keeps its own text (the URL would round it, and the field must not be
// re-rendered under the typing hand); the URL stays the only source of the filter and the field follows it.
const AUTO_SEARCH_DELAY = 500
const tagsInput = ref(filter.value.tags)
const tagsField = useTemplateRef<HTMLInputElement>('tagsField')
let tagsTimer: ReturnType<typeof setTimeout> | undefined
function cancelTagsTimer() {
  clearTimeout(tagsTimer)
  tagsTimer = undefined
}
function onTagsInput() {
  cancelTagsTimer()
  const text = tagsInput.value.trim()
  if (!text) return setFilter('tags', '')
  // Only complete input is sent on its own; "100-" waits for Enter or leaving the field. A pause is a replace,
  // so that searching does not fill the browser history; the first filter after "none" is a step of its own.
  if (!isReadableTags(text)) return
  tagsTimer = setTimeout(() => {
    tagsTimer = undefined
    setFilter('tags', text, filter.value.tags !== '')
  }, AUTO_SEARCH_DELAY)
}
// Enter and leaving the field apply at once, whatever was typed
function applyTagsNow() {
  cancelTagsTimer()
  setFilter('tags', tagsInput.value)
}
function clearTags() {
  cancelTagsTimer()
  tagsInput.value = ''
  setFilter('tags', '')
  tagsField.value?.focus()
}
// The URL changed from outside (back button, reset): the field shows it and a waiting pause is dropped.
// Our own change has the same text as the field (apart from blanks), so typing is not disturbed.
watch(
  () => filter.value.tags,
  (tags) => {
    if (tagsInput.value.trim() === tags) return
    cancelTagsTimer()
    tagsInput.value = tags
  },
)
onBeforeUnmount(cancelTagsTimer)

// A set filter (per the URL) turns white with a black border; an empty one stays on the grey page, and focus makes it white while typing.
function fieldClass(name: (typeof FILTERS)[number]) {
  return [
    'mt-1 h-11 rounded-lg border-2 px-3 text-base text-ink placeholder:text-dim focus:bg-paper',
    filter.value[name] ? 'border-ink bg-paper' : 'border-dim bg-transparent',
  ]
}

const hasFilter = computed(() => FILTERS.some((name) => filter.value[name]))
function resetFilter() {
  // A pause that is still running or text that was never applied must not bring the old filter back.
  cancelTagsTimer()
  tagsInput.value = ''
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
const status = ref<'loading' | 'ready' | 'invalid' | 'error'>('loading')
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
    // 400 = the server cannot read the filter: that is an empty result for the user, not a fault
    status.value = failure.value === 400 ? 'invalid' : 'error'
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
    <p class="text-mute">Wer hat wann was erfasst?</p>

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

    <div v-if="status === 'error'" class="mt-6" role="alert">
      <p class="font-bold">
        {{
          failure === 0
            ? 'Keine Verbindung zum Server.'
            : 'Die Aktivität konnte nicht geladen werden.'
        }}
      </p>
      <button
        type="button"
        class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
        @click="load"
      >
        Erneut versuchen
      </button>
    </div>

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
      v-else-if="status === 'invalid' || !entries.length"
      title="Waldesruh"
      text-class="md:whitespace-nowrap"
      role="status"
    >
      <template #icon>
        <TreesIcon :size="96" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
      </template>
      <!-- Not broken up on wide screens; on a phone it has to wrap. -->
      <template #text>
        {{
          status === 'invalid'
            ? 'Die Filter verstehen wir nicht. Kennung zum Beispiel 104 oder 100-120.'
            : 'Für diese Auswahl gibt es keine Einträge.'
        }}
      </template>
      <button
        v-if="hasFilter"
        type="button"
        class="h-11 rounded-lg border-2 border-ink px-4 font-bold"
        @click="resetFilter"
      >
        Filter zurücksetzen
      </button>
    </StatusCard>

    <template v-else>
      <p v-if="totals" class="mt-6 flex flex-wrap items-baseline gap-x-3">
        <span class="text-lg font-bold">{{ entriesText(totals.entries) }}</span>
        <span class="text-sm text-mute">Uhrzeit = Eingang am Server · „erfasst“ = Uhrzeit am Handy</span>
      </p>

      <section
        v-for="day in days"
        :key="day.key"
        class="card mt-4 px-4 sm:px-6"
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
