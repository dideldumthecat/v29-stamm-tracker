<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeftIcon, CircleCheckIcon, RefreshCwIcon } from '@lucide/vue'
import { ApiError } from '@/api/client'
import type { Event } from '@/api/contract'
import { useTimberItemStore } from '@/stores/timberItems'
import { formatValue } from '@/utils/attributeDraft'
import { formatShortDateTime } from '@/utils/date'
import FormattedTag from '@/components/FormattedTag.vue'
import SignInForm from '@/components/SignInForm.vue'

const router = useRouter()
const store = useTimberItemStore()

const isSyncing = ref(false)
// Set after a successful sync: the page stays on the result until the user leaves.
const transferred = ref<number | null>(null)
const failure = ref<ApiError | null>(null)

// Pending events grouped by item, in recording order; the tag belongs to "angelegt" and gets no row.
const groups = computed(() => {
  const byItem = new Map<string, Event[]>()
  for (const event of store.events) {
    if (event.type !== 'tag_assigned') {
      byItem.set(event.timber_item_id, [...(byItem.get(event.timber_item_id) ?? []), event])
    }
  }
  return [...byItem].map(([itemId, events]) => {
    const item = store.items.find((candidate) => candidate.id === itemId)
    return {
      itemId,
      tagNumber: item?.tag_number ?? null,
      kind: item?.parent_id ? 'Balken' : 'Stamm',
      isNew: events.some((event) => event.type === 'created'),
      events,
    }
  })
})

function describe(event: Event, kind: string): string {
  if (event.type !== 'attribute_recorded') {
    return `${kind} angelegt`
  }
  const attribute = store.attributes.find((candidate) => candidate.id === event.data.attribute_id)
  if (!attribute) {
    return 'Unbekanntes Merkmal'
  }
  const value = formatValue(attribute, event.data.value) ?? String(event.data.value)
  // Boolean values already read as a sentence ("Gesägt", "Gesägt: Nein").
  return attribute.type === 'boolean' ? value : `${attribute.name}: ${value}`
}

const failureText = computed(() => {
  const error = failure.value
  if (!error) {
    return null
  }
  const count = store.pendingCount
  const kept = `Deine ${count} ${count === 1 ? 'Eintrag bleibt' : 'Einträge bleiben'} auf diesem Gerät.`
  switch (error.status) {
    case 0:
      return `Keine Verbindung zum Server. ${kept} Versuch es erneut, sobald du Empfang hast.`
    case 401:
      return `Kein Zugang: Dieses Gerät ist nicht (mehr) angemeldet. ${kept} Melde dich mit deinem Einladungscode neu an.`
    case 400:
      // The server rejects the whole batch; retrying sends the same batch again.
      return `Der Server hat die Übertragung abgelehnt (${error.message}). ${kept} Erneutes Versuchen hilft nicht – bitte melde das der Administration.`
    default:
      return `Fehler auf dem Server (${error.status}). ${kept} Versuch es später erneut.`
  }
})

async function onSync() {
  isSyncing.value = true
  failure.value = null
  try {
    transferred.value = await store.sync()
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }
    failure.value = error
  } finally {
    isSyncing.value = false
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-col overflow-y-auto">
    <header class="flex items-center gap-3 border-b-2 border-ink py-3 px-gutter">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg border-2 border-current"
        aria-label="Zurück"
        @click="router.push({ name: 'start' })"
      >
        <ChevronLeftIcon :size="22" aria-hidden="true" />
      </button>
      <h1 class="flex-1 text-center text-xl font-bold">
        Synchronisierung<template v-if="store.pendingCount > 0">
          ({{ store.pendingCount }})</template
        >
      </h1>
      <span class="w-11 shrink-0"></span>
    </header>
    <p class="border-b border-line py-2 px-gutter text-center text-[13px] text-mute">
      Zuletzt synchronisiert:
      {{ store.lastSyncedAt ? formatShortDateTime(store.lastSyncedAt) : 'noch nie' }}
    </p>

    <div
      v-if="transferred !== null || groups.length === 0"
      class="flex flex-auto flex-col items-center justify-center gap-4 py-8 px-gutter text-center"
      role="status"
    >
      <CircleCheckIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
      <h2 class="text-[26px] font-bold text-balance">
        {{ transferred !== null ? 'Synchronisiert' : 'Alles auf dem neuesten Stand' }}
      </h2>
      <p class="max-w-[32ch] leading-[1.45] text-mute">
        <template v-if="transferred">
          {{ transferred }} {{ transferred === 1 ? 'Eintrag' : 'Einträge' }} übertragen, aktueller
          Stand geladen.
        </template>
        <template v-else-if="transferred === 0">Aktueller Stand geladen.</template>
        <template v-else>Auf diesem Gerät gibt es keine offenen Änderungen.</template>
      </p>
    </div>

    <div v-else class="flex flex-col gap-5 py-4 px-gutter">
      <section v-for="group in groups" :key="group.itemId">
        <RouterLink
          v-if="group.tagNumber"
          :to="{ name: 'timber-item', params: { tagNumber: group.tagNumber } }"
          class="flex min-h-11 w-full items-center justify-between border-b-2 border-ink text-left"
        >
          <strong class="flex items-center gap-2 text-lg tabular-nums">
            <span>{{ group.kind }} <FormattedTag :tag-number="group.tagNumber" /></span>
            <span
              v-if="group.isNew"
              class="rounded-xl border-[1.5px] border-current px-2 py-[3px] text-xs font-semibold whitespace-nowrap"
              >neu</span
            >
          </strong>
          <span class="text-sm">öffnen ›</span>
        </RouterLink>
        <div
          v-for="event in group.events"
          :key="event.id"
          class="flex min-h-14 flex-col justify-center border-b border-line py-1.5"
        >
          <b class="font-semibold wrap-anywhere">{{ describe(event, group.kind) }}</b>
          <span class="text-[13px] text-mute">{{ formatShortDateTime(event.recorded_at) }}</span>
        </div>
      </section>
      <p class="rounded-lg bg-well p-3 text-sm leading-[1.4]">
        Bis zum Sync sind das Entwürfe und frei änderbar.
      </p>
    </div>

    <div class="flex-auto"></div>

    <div
      class="sticky bottom-0 z-5 flex flex-col gap-2 border-t border-line bg-well pt-3 px-gutter pb-safe-4"
    >
      <div
        v-if="failureText"
        class="flex flex-col gap-1 rounded-lg border-2 border-ink bg-paper px-3.5 py-3 text-sm leading-[1.4]"
        role="alert"
      >
        <strong class="text-base">Synchronisieren fehlgeschlagen</strong>
        <span>{{ failureText }}</span>
      </div>
      <SignInForm v-if="failure?.status === 401" @signed-in="onSync" />
      <button
        v-else-if="transferred !== null"
        type="button"
        class="flex h-[88px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper short:h-16"
        @click="router.push({ name: 'start' })"
      >
        Zurück zum Start
      </button>
      <template v-else>
        <button
          type="button"
          class="flex h-[88px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper disabled:cursor-default disabled:bg-disabled disabled:text-mute short:h-16"
          :disabled="isSyncing"
          @click="onSync"
        >
          <span
            class="flex"
            :class="{ 'animate-spin motion-reduce:animate-none': isSyncing }"
            aria-hidden="true"
            ><RefreshCwIcon :size="18"
          /></span>
          {{
            isSyncing ? 'Synchronisiere …' : failure ? 'Erneut versuchen' : 'Jetzt synchronisieren'
          }}
        </button>
        <span class="text-center text-[13px] text-mute"
          >Braucht Empfang · lädt danach den aktuellen Stand</span
        >
      </template>
    </div>
  </div>
</template>
