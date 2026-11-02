<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  ChevronRightIcon,
  CircleCheckIcon,
  PauseIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue'
import { ApiError } from '@/api/client'
import type { Event } from '@/api/contract'
import { useTimberItemStore, type StoredPhoto, type SyncResult } from '@/stores/timberItems'
import { checkForUpdateNow } from '@/composables/useUpdateCheck'
import { formatValue } from '@/utils/attributeDraft'
import { formatShortDateTime } from '@/utils/date'
import { formatBytes } from '@/utils/photo'
import { useToast } from '@/composables/useToast'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import FormattedTag from '@/components/FormattedTag.vue'
import RejectedAlerts from '@/components/RejectedAlerts.vue'
import SignInForm from '@/components/SignInForm.vue'

const router = useRouter()
const store = useTimberItemStore()

// Set after a successful sync: the page stays on the result until the user leaves.
// A sync right after sign-in elsewhere hands its result over when it rejected something.
const result = ref((router.options.history.state.syncResult as SyncResult | undefined) ?? null)
const transferred = computed(() => result.value?.transferred ?? null)
const uploadedPhotos = computed(() => result.value?.photos?.uploaded ?? 0)
// "3 Einträge übertragen, 2 Fotos hochgeladen" – whichever parts there are.
const transferredText = computed(() =>
  [
    transferred.value
      ? `${transferred.value} ${transferred.value === 1 ? 'Eintrag' : 'Einträge'} übertragen`
      : null,
    uploadedPhotos.value
      ? `${uploadedPhotos.value} ${uploadedPhotos.value === 1 ? 'Foto' : 'Fotos'} hochgeladen`
      : null,
  ]
    .filter((part) => part !== null)
    .join(', '),
)
const failure = ref<ApiError | null>(null)

// Pending events grouped by item, in recording order; the tag of a new item belongs to "angelegt" and gets no row.
// Photos whose event is already on the server (only the file is left) have no event: they get a row of their own.
const groups = computed(() => {
  const byItem = new Map<string, { events: Event[]; photos: StoredPhoto[] }>()
  const of = (itemId: string) => {
    if (!byItem.has(itemId)) {
      byItem.set(itemId, { events: [], photos: [] })
    }
    return byItem.get(itemId)!
  }
  for (const event of store.events) {
    if (store.isEntry(event)) {
      of(event.timber_item_id).events.push(event)
    }
  }
  for (const photo of store.photos) {
    if (!store.isPhotoQueued(photo.id)) {
      of(photo.timber_item_id).photos.push(photo)
    }
  }
  return [...byItem].map(([itemId, { events, photos }]) => {
    // A removed beam is gone from the items, but its row must still name it.
    const removed = store.removedBeams.get(itemId)
    const item = removed ?? store.items.find((candidate) => candidate.id === itemId)
    return {
      itemId,
      parentId: item?.parent_id ?? null,
      tagNumber: item?.tag_number ?? null,
      isRemoved: removed !== undefined,
      kind: item?.parent_id ? 'Balken' : 'Stamm',
      isNew: events.some((event) => event.type === 'created'),
      events,
      photos,
    }
  })
})

type Group = (typeof groups.value)[number]

// One section per stem, whatever the entry belongs to: the only way to a beam leads through its stem.
// A section is the stem block (even without entries of its own), then one block per beam by tag.
// Sections come in the order of their first entry.
const sections = computed(() => {
  const byStem = new Map<string, { stem?: Group; beams: Group[] }>()
  for (const group of groups.value) {
    const stemId = group.parentId ?? group.itemId
    if (!byStem.has(stemId)) {
      byStem.set(stemId, { beams: [] })
    }
    const section = byStem.get(stemId)!
    if (group.parentId) {
      section.beams.push(group)
    } else {
      section.stem = group
    }
  }
  return [...byStem].map(([stemId, { stem, beams }]) => ({
    stemId,
    blocks: [
      stem ?? {
        itemId: stemId,
        parentId: null,
        tagNumber: store.items.find((item) => item.id === stemId)?.tag_number ?? null,
        isRemoved: false,
        kind: 'Stamm',
        isNew: false,
        events: [],
        photos: [],
      },
      ...beams.sort((a, b) => (a.tagNumber ?? '').localeCompare(b.tagNumber ?? '')),
    ],
  }))
})

const photoBytes = computed(() => store.photos.reduce((sum, photo) => sum + photo.size, 0))
const photoOf = (event: Event) =>
  event.type === 'attribute_recorded'
    ? store.photos.find((photo) => photo.id === event.data.value)
    : undefined

const progressText = computed(() => {
  const current = store.progress
  return current?.phase === 'photos'
    ? `Foto ${Math.min(current.done + 1, current.total)} von ${current.total}`
    : 'Daten werden übertragen …'
})
const progressPercent = computed(() =>
  store.progress?.phase === 'photos' ? (store.progress.done / store.progress.total) * 100 : 0,
)

const photoLabel = (photo: StoredPhoto) => `Foto (${formatBytes(photo.size)})`

// The result page stands for "everything is on the server"; photos still waiting keep the list.
const isDone = computed(
  () => store.pendingCount === 0 || (result.value !== null && store.photos.length === 0),
)

function describe(event: Event, kind: string): string {
  // Entries are "created" or "attribute_recorded"; a tag belongs to its "created".
  if (event.type !== 'attribute_recorded') {
    return `${kind} angelegt`
  }
  const attribute = store.attributes.find((candidate) => candidate.id === event.data.attribute_id)
  if (!attribute) {
    return 'Unbekanntes Merkmal'
  }
  if (attribute.type === 'photo') {
    const photo = photoOf(event)
    return photo ? photoLabel(photo) : 'Foto'
  }
  const value = formatValue(attribute, event.data.value) ?? String(event.data.value)
  // Boolean values already read as a sentence ("Gesägt", "Gesägt: Nein").
  return attribute.type === 'boolean' ? value : `${attribute.name}: ${value}`
}

const toDiscard = ref<{ event: Event; group: Group } | null>(null)
// A new stem takes its new beams along; a beam has none.
const discardedBeamCount = computed(() =>
  toDiscard.value?.event.type === 'created' && toDiscard.value.group.kind === 'Stamm'
    ? store.childrenOf(toDiscard.value.group.itemId).length
    : 0,
)

// Tag of the new beam that blocks discarding a removal; null if the removal can be discarded.
const blockedTag = computed(() =>
  toDiscard.value ? store.tagTakenOver(toDiscard.value.event) : null,
)

function onDiscard() {
  store.discardEntry(toDiscard.value!.event.id)
  toDiscard.value = null
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

function photoNotice({ photos, cancelled }: SyncResult): string | null {
  const open = store.photos.length
  const left = `${open} ${open === 1 ? 'Foto bleibt' : 'Fotos bleiben'} auf diesem Gerät.`
  if (cancelled === 'photos') {
    return `Angehalten. ${left}`
  }
  if (!photos?.failed) {
    return null
  }
  const reason =
    photos.errorStatus === 0
      ? 'Keine Verbindung zum Server'
      : photos.errorStatus === 413
        ? 'Datei zu groß'
        : photos.errorStatus === 415
          ? 'Datei ist kein JPEG'
          : `Fehler ${photos.errorStatus}`
  return `${photos.failed} von ${photos.uploaded + photos.failed} Fotos konnten nicht hochgeladen werden (${reason}). ${left}`
}

async function onSync() {
  failure.value = null
  // The "Angehalten" toast of the previous run no longer applies.
  useToast().hide()
  try {
    const synced = await store.sync()
    if (synced.cancelled === 'data') {
      const count = store.pendingCount
      useToast().show({
        before: `Angehalten. Deine ${count} ${count === 1 ? 'Eintrag bleibt' : 'Einträge bleiben'} auf diesem Gerät.`,
        kind: 'warning',
      })
      return
    }
    result.value = synced
    const notice = photoNotice(synced)
    if (notice) {
      useToast().show({ before: notice, kind: 'warning' })
    }
    // Reception is proven now. Not awaited: the result page must not wait for it.
    void checkForUpdateNow()
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error
    }
    failure.value = error
  }
}

// One button for both: while syncing, a tap stops the sync.
function onMainButton() {
  return store.isSyncing ? store.stopSync() : onSync()
}
</script>

<template>
  <div class="flex min-h-0 flex-col overflow-y-auto">
    <header class="flex h-header shrink-0 items-center gap-3 border-b-2 border-ink px-gutter">
      <button
        type="button"
        class="flex size-11 items-center justify-center rounded-lg border-2 border-current"
        aria-label="Schließen"
        @click="router.push({ name: 'start' })"
      >
        <XIcon :size="22" aria-hidden="true" />
      </button>
      <h1 class="flex-1 text-center text-xl font-bold">
        Synchronisierung<template v-if="store.pendingCount > 0">
          ({{ store.pendingCount }})</template
        >
      </h1>
      <span class="w-11 shrink-0"></span>
    </header>
    <p class="border-b border-line py-2 px-gutter text-center text-[13px] text-mute">
      Stand der Daten:
      {{ store.lastSyncedAt ? formatShortDateTime(store.lastSyncedAt) : 'noch nie' }}
    </p>

    <div
      v-if="isDone"
      class="flex flex-auto flex-col items-center justify-center gap-4 py-8 px-gutter text-center"
      role="status"
    >
      <CircleCheckIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
      <h2 class="text-[26px] font-bold text-balance">
        {{ transferred !== null ? 'Synchronisiert' : 'Keine Änderungen auf diesem Gerät' }}
      </h2>
      <p class="max-w-[32ch] leading-[1.45] text-mute">
        <template v-if="transferredText">{{ transferredText }}, aktueller Stand geladen.</template>
        <template v-else-if="transferred === 0">Aktueller Stand geladen.</template>
        <template v-else>Daten aktualisieren lädt den neuesten Stand vom Server.</template>
      </p>
      <RejectedAlerts :rejected="result?.rejected ?? []" />
    </div>

    <div v-else class="flex flex-col gap-5 py-4 px-gutter">
      <RejectedAlerts :rejected="result?.rejected ?? []" />
      <section v-for="section in sections" :key="section.stemId">
        <template v-for="group in section.blocks" :key="group.itemId">
          <!-- A removed beam has no screen to link to: its heading stands alone. -->
          <component
            :is="group.tagNumber && !group.isRemoved ? RouterLink : 'div'"
            v-if="group.tagNumber"
            v-bind="
              group.tagNumber && !group.isRemoved
                ? { to: { name: 'timber-item', params: { tagNumber: group.tagNumber } } }
                : {}
            "
            class="flex min-h-11 items-center justify-between text-left"
            :class="
              group.parentId
                ? 'ml-4 w-[calc(100%-1rem)] border-b border-line'
                : 'w-full border-b-2 border-ink'
            "
          >
            <strong
              class="flex items-center gap-2 tabular-nums"
              :class="group.parentId ? 'text-base' : 'text-lg'"
            >
              <span
                >{{ group.kind }}
                <FormattedTag
                  :tag-number="group.tagNumber"
                  :class="group.isRemoved ? '' : 'underline underline-offset-4'"
              /></span>
              <span
                v-if="group.isNew"
                class="rounded-xl border-[1.5px] border-current px-2 py-[3px] text-xs font-semibold whitespace-nowrap"
                >neu</span
              >
            </strong>
            <ChevronRightIcon
              v-if="!group.isRemoved"
              :size="group.parentId ? 20 : 24"
              class="shrink-0"
              aria-hidden="true"
            />
          </component>
          <div
            v-for="event in group.events"
            :key="event.id"
            class="flex items-center gap-2 border-b border-line"
          >
            <div class="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-1.5">
              <b v-if="event.type === 'voided'" class="font-semibold wrap-anywhere"
                >{{ group.kind }} <FormattedTag :tag-number="group.tagNumber!" /> entfernen</b
              >
              <b v-else class="font-semibold wrap-anywhere">{{ describe(event, group.kind) }}</b>
              <span class="text-[13px] text-mute">{{
                formatShortDateTime(event.recorded_at)
              }}</span>
            </div>
            <button
              type="button"
              class="flex size-11 shrink-0 items-center justify-center rounded-md border-2 border-ink bg-paper text-ink disabled:border-lockline disabled:text-mute"
              aria-label="Eintrag verwerfen"
              :disabled="store.isSyncing"
              @click="toDiscard = { event, group }"
            >
              <Trash2Icon :size="20" :stroke-width="2.5" aria-hidden="true" />
            </button>
          </div>
          <div
            v-for="photo in group.photos"
            :key="photo.id"
            class="flex min-h-14 flex-col justify-center border-b border-line py-1.5"
          >
            <b class="font-semibold">{{ photoLabel(photo) }}</b>
            <span class="text-[13px] text-mute">{{ formatShortDateTime(photo.taken_at) }}</span>
          </div>
        </template>
      </section>
    </div>

    <div class="flex-auto"></div>

    <div
      class="sticky bottom-0 z-5 flex flex-col gap-2 border-t border-line bg-well pt-3 px-gutter pb-4"
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
        v-else-if="transferred !== null && isDone"
        type="button"
        class="flex h-[88px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper short:h-16"
        @click="router.push({ name: 'start' })"
      >
        Zurück zum Start
      </button>
      <template v-else>
        <span
          v-if="store.photos.length > 0 && !store.isSyncing"
          class="text-center text-sm font-semibold"
          >{{ store.photos.length }} {{ store.photos.length === 1 ? 'Foto' : 'Fotos' }} ·
          {{ formatBytes(photoBytes) }}</span
        >
        <div v-if="store.isSyncing" class="flex flex-col gap-1.5">
          <div
            class="relative h-2.5 overflow-hidden rounded-full bg-soft"
            role="progressbar"
            aria-label="Fortschritt der Synchronisierung"
            :aria-valuetext="progressText"
          >
            <div
              v-if="store.progress?.phase === 'photos'"
              class="h-full bg-ink transition-[width]"
              :style="{ width: `${progressPercent}%` }"
            ></div>
            <div
              v-else
              class="absolute inset-y-0 w-2/5 animate-indeterminate bg-ink motion-reduce:inset-x-0 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40"
            ></div>
          </div>
          <span class="flex items-center justify-center gap-1.5 text-[13px] text-mute"
            ><RefreshCwIcon
              :size="14"
              class="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />{{ progressText }}</span
          >
        </div>
        <button
          type="button"
          class="flex h-[88px] w-full items-center justify-center gap-2.5 rounded-lg text-lg font-bold disabled:cursor-default disabled:bg-disabled disabled:text-mute short:h-16"
          :class="
            store.isSyncing
              ? 'border-2 border-ink bg-paper text-ink disabled:border-lockline'
              : 'bg-ink text-paper'
          "
          :disabled="store.isStopping"
          :aria-label="
            store.isSyncing && !store.isStopping ? 'Synchronisierung anhalten' : undefined
          "
          @click="onMainButton"
        >
          <PauseIcon v-if="store.isSyncing && !store.isStopping" :size="18" aria-hidden="true" />
          <RefreshCwIcon v-else-if="!store.isSyncing" :size="18" aria-hidden="true" />
          {{
            store.isStopping
              ? 'Wird angehalten …'
              : store.isSyncing
                ? 'Anhalten'
                : failure
                  ? 'Erneut versuchen'
                  : groups.length
                    ? 'Jetzt synchronisieren'
                    : 'Daten aktualisieren'
          }}
        </button>
        <span v-if="!store.isSyncing" class="text-center text-[13px] text-mute"
          >Braucht Empfang · lädt danach den aktuellen Stand</span
        >
      </template>
    </div>

    <ConfirmSheet
      v-if="toDiscard"
      :safe-label="blockedTag ? 'Verstanden' : 'Abbrechen'"
      :action-label="blockedTag ? undefined : 'Verwerfen'"
      emphasize-action
      @safe="toDiscard = null"
      @action="onDiscard"
    >
      <template #title>
        <template v-if="toDiscard.event.type === 'created'">
          {{ toDiscard.group.kind }} <FormattedTag :tag-number="toDiscard.group.tagNumber!" /> mit
          allen Angaben<template v-if="discardedBeamCount > 0">
            und {{ discardedBeamCount }} Balken</template
          >
          verwerfen?
        </template>
        <template v-else-if="toDiscard.event.type === 'voided'">
          Entfernen von {{ toDiscard.group.kind }}
          <FormattedTag :tag-number="toDiscard.group.tagNumber!" /> verwerfen?
        </template>
        <template v-else>Eintrag verwerfen?</template>
      </template>
      <p v-if="blockedTag">
        Der Buchstabe {{ blockedTag.slice(-1) }} ist inzwischen an einen neuen Balken vergeben. Um
        <FormattedTag :tag-number="blockedTag" /> zurückzuholen, erst den neuen Balken
        <FormattedTag :tag-number="blockedTag" /> entfernen.
      </p>
      <p v-else-if="toDiscard.event.type === 'voided'">
        Der Balken ist danach wieder da. Der Buchstabe
        {{ toDiscard.group.tagNumber!.slice(-1) }} ist dann wieder belegt.
      </p>
      <p v-else-if="toDiscard.event.type !== 'created'">
        {{ describe(toDiscard.event, toDiscard.group.kind) }}<br /><template
          v-if="photoOf(toDiscard.event)"
          >Das Foto wird vom Gerät gelöscht.<br /></template
        >Der bisherige Stand gilt wieder.
      </p>
      <p v-else>Nichts davon wird synchronisiert. Die Plakette ist danach wieder frei.</p>
    </ConfirmSheet>
  </div>
</template>
