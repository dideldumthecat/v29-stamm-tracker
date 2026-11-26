<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type RouteLocationNormalized,
} from 'vue-router'
import type { AdminAttribute, AdminAttributesResponse } from '@/api/contract'
import { CheckIcon, GripVerticalIcon, LockIcon, MousePointerClickIcon, PlusIcon } from '@lucide/vue'

import { ApiError, request } from '@/api/client'
import { errorsOf } from '@/apiErrors'
import AttributePreviewField from '@/components/AttributePreviewField.vue'
import AttributeSettings from '@/components/AttributeSettings.vue'
import AttributeTypePicker from '@/components/AttributeTypePicker.vue'
import DiscardDialog from '@/components/DiscardDialog.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import StatusCard from '@/components/StatusCard.vue'
import {
  applyVisibleOrder,
  bodyOf,
  countAttributes,
  draftOf,
  hidingCandidates,
  isChanged,
  isInheritedOnly,
  moveItem,
  NEW_ATTRIBUTE,
  newDraft,
  previewOf,
  readQuery,
  sameDraft,
  tileOf,
  visibleAttributes,
  withNewType,
  writeQuery,
  type AttributeDraft,
  type AttributesQuery,
  type TileType,
} from '@/attributes'
import { useReorder } from '@/reorder'

const route = useRoute()
const router = useRouter()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref(0)
const attributes = ref<AdminAttribute[]>([])

async function load() {
  status.value = 'loading'
  try {
    attributes.value = (
      await request<AdminAttributesResponse>('GET', 'admin/attributes')
    ).attributes
    status.value = 'ready'
  } catch (error) {
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
  }
}
void load()

// The URL is the only source of the view, "Inaktive zeigen" and the selection (an attribute, or `new` for the draft of a new one).
const query = computed(() => readQuery(route.query))
const isNew = computed(() => query.value.attribute === NEW_ATTRIBUTE)
const visible = computed(() =>
  visibleAttributes(attributes.value, query.value.view, query.value.inactive),
)
// What is not in the preview is not selected, whatever the URL says
const selected = computed(
  () => visible.value.find((attribute) => attribute.id === query.value.attribute) ?? null,
)
/** What is selected, as one value to compare: the draft, an attribute of the preview, or nothing. */
const selectionOf = (next: AttributesQuery) =>
  next.attribute === NEW_ATTRIBUTE
    ? NEW_ATTRIBUTE
    : (visibleAttributes(attributes.value, next.view, next.inactive).find(
        (attribute) => attribute.id === next.attribute,
      )?.id ?? null)

// Set while the page itself navigates away from a form it has just closed (after "Anlegen"): the question below does not apply
let proceeding = false
async function go(next: Partial<AttributesQuery>, force = false) {
  proceeding = force
  try {
    await router.push({ query: writeQuery({ ...query.value, ...next }) })
  } finally {
    proceeding = false
  }
}
// The selection goes with a view that does not show it, and a draft goes with any change of the view
const keepsSelection = (view: AttributesQuery['view'], inactive: boolean) =>
  query.value.attribute !== NEW_ATTRIBUTE &&
  selectionOf({ ...query.value, view, inactive }) === query.value.attribute
    ? query.value.attribute
    : null
const selectView = (view: AttributesQuery['view']) =>
  go({ view, attribute: keepsSelection(view, query.value.inactive) })
const setInactive = (inactive: boolean) =>
  go({ inactive, attribute: keepsSelection(query.value.view, inactive) })

// --- The form of the selected attribute or of the new one ----------------------------------------------------------------------

const draft = ref<AttributeDraft | null>(null)
/** The type tiles or the form: a new attribute starts with the tiles, "ändern" at the type of an existing one leads to them too. */
const newStep = ref<'type' | 'form'>('type')
const errors = ref<Record<string, string>>({})
const saving = ref(false)
const saveFailed = ref(false)
function resetDraft() {
  newStep.value = isNew.value ? 'type' : 'form'
  draft.value = selected.value ? draftOf(selected.value) : null
  errors.value = {}
  saveFailed.value = false
}
watch(() => (isNew.value ? NEW_ATTRIBUTE : selected.value?.id), resetDraft, { immediate: true })
// An edit makes the messages of the last save out of date
watch(draft, () => (errors.value = {}), { deep: true })

// A draft counts as soon as it differs from the defaults of its type: choosing a type and leaving again loses nothing
const changed = computed(() => {
  if (!draft.value) return false
  if (isNew.value) return !sameDraft(draft.value, newDraft(draft.value.type, query.value.view))
  return !!selected.value && isChanged(selected.value, draft.value)
})

function pickType(tile: TileType) {
  // The same tile again keeps a month a month
  const type = draft.value && tileOf(draft.value.type) === tile ? draft.value.type : tile
  draft.value = draft.value ? withNewType(draft.value, type) : newDraft(type, query.value.view)
  newStep.value = 'form'
}
// The new attribute in the preview in place of the placeholder, once type and name are there
const livePreview = computed(() =>
  isNew.value && newStep.value === 'form' && draft.value?.name.trim()
    ? previewOf(draft.value)
    : null,
)

async function save() {
  if (!draft.value || saving.value) return
  const creating = isNew.value
  const attribute = selected.value
  if (!creating && !attribute) return
  saving.value = true
  saveFailed.value = false
  try {
    if (creating) {
      const created = await request<AdminAttribute>('POST', 'admin/attributes', bodyOf(draft.value))
      attributes.value = [...attributes.value, created]
      // It stays selected, now as an attribute: in a view where it shows (it may be for the other kind, or inactive)
      const view = created.applies_to.includes(query.value.view)
        ? query.value.view
        : created.applies_to[0]
      createdId = created.id
      await go(
        { view, inactive: query.value.inactive || !created.active, attribute: created.id },
        true,
      )
      await nextTick()
      settings.value?.focusHeading()
      confirmSaved(created)
      return
    }
    const saved = await request<AdminAttribute>(
      'PATCH',
      `admin/attributes/${attribute!.id}`,
      // The rest of a system attribute is fixed in the code: only what may change goes to the server
      attribute!.is_system
        ? { name: draft.value.name, description: draft.value.description }
        : bodyOf(draft.value),
    )
    attributes.value = attributes.value.map((entry) => (entry.id === saved.id ? saved : entry))
    // The selection stays; the form shows what the server made of it (trimmed texts, the options with ids)
    await nextTick()
    resetDraft()
    await nextTick()
    settings.value?.focusHeading()
    confirmSaved(saved)
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      errors.value = errorsOf(error.body)
      // To the first field with a message (once the messages are drawn)
      await nextTick()
      settings.value?.focusFirstError()
    } else saveFailed.value = true
  } finally {
    saving.value = false
  }
}

// --- The order: dragging the handle or the arrow keys, saved at once -------------------------------------------------------------

const list = useTemplateRef<HTMLElement>('list')
const ordering = ref(false)
const orderFailed = ref(false)
/** "Reihenfolge gespeichert" or "Merkmal gespeichert" beside the count, for about 3 seconds after a successful save. */
const savedText = ref('')
let savedTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(savedTimer))
/** What a screen reader hears once a move is saved (the live region; the message in the bar is hidden from it so nothing is read twice). */
const announcement = ref('')
const items = () =>
  [...(list.value?.children ?? [])].slice(0, visible.value.length) as HTMLElement[]
const reorder = useReorder((from, to) => void moveAttribute(from, to))

/** After a save: "Merkmal gespeichert" beside the count for about 3 seconds, and the same words for a screen reader. Nothing else moves. */
async function confirmSaved(saved: AdminAttribute) {
  clearTimeout(savedTimer)
  savedText.value = 'Merkmal gespeichert'
  savedTimer = setTimeout(() => (savedText.value = ''), 3000)
  // Emptied first: the same words twice in a row are only read again if the region changed in between
  announcement.value = ''
  await nextTick()
  announcement.value = `Merkmal „${saved.name}“ gespeichert.`
}

/**
 * Moves the attribute at `from` in the preview to `to`. The order is global: the preview holds only the attributes of its view, they
 * take each other's places in the whole list and everything else stays where it is. The new order is shown at once and saved; if
 * that fails it goes back to the old one.
 */
async function moveAttribute(from: number, to: number) {
  if (ordering.value) return
  const before = attributes.value
  const moved = visible.value[from]
  const next = applyVisibleOrder(before, moveItem(visible.value, from, to)).map(
    (attribute, index) => ({ ...attribute, sort_order: 10 * (index + 1) }),
  )
  attributes.value = next
  const where = `${moved.name} ist jetzt an Stelle ${to + 1} von ${visible.value.length}.`
  ordering.value = true
  orderFailed.value = false
  savedText.value = ''
  clearTimeout(savedTimer)
  // Emptied first: the same words twice in a row are only read again if the region changed in between
  announcement.value = ''
  try {
    await request('PUT', 'admin/attributes/order', { ids: next.map((attribute) => attribute.id) })
    announcement.value = `${where} Reihenfolge gespeichert.`
    savedText.value = 'Reihenfolge gespeichert'
    savedTimer = setTimeout(() => (savedText.value = ''), 3000)
  } catch {
    attributes.value = before
    orderFailed.value = true
  } finally {
    ordering.value = false
  }
}
async function moveBy(index: number, direction: -1 | 1) {
  const to = index + direction
  if (to < 0 || to >= visible.value.length) return
  const id = visible.value[index].id
  void moveAttribute(index, to)
  // The row moves in the DOM, which takes the focus off its handle: give it back
  await nextTick()
  list.value
    ?.querySelector<HTMLElement>(`[data-attribute="${id}"] button[aria-label$="verschieben"]`)
    ?.focus()
}

// --- Switching or leaving with unsaved changes ------------------------------------------------------------------------------------

// A change of the selection or the view asks first (the page stays where it is meanwhile); "Inaktive zeigen" only if the selection goes.
// Leaving the page asks the same, except for the sign-in page: signing out and an expired session lose the draft without a question.
// A route update is the one place for the first: the buttons, the preview and the browser's back button all pass here.
const asking = ref(false)
let pending: RouteLocationNormalized | null = null
function ask(to: RouteLocationNormalized) {
  pending = to
  asking.value = true
  return false
}
onBeforeRouteUpdate((to) => {
  if (proceeding || !changed.value) return true
  const next = readQuery(to.query)
  if (next.view === query.value.view && selectionOf(next) === selectionOf(query.value)) return true
  return ask(to)
})
onBeforeRouteLeave((to) => (proceeding || !changed.value || to.name === 'login' ? true : ask(to)))
function discard() {
  resetDraft()
  const to = pending
  const closed = closing
  pending = null
  closing = null
  if (to) void router.push(to).then(() => closed && focusInPreview(closed))
}
watch(asking, (open) => {
  if (!open) {
    pending = null
    closing = null
  }
})

// The X of the form ends the selection (with the same question as any other change of the selection); the focus goes to the attribute that
// was closed, once it is closed (after the question, if there was one)
let closing: string | null = null
function focusInPreview(id: string) {
  list.value
    ?.querySelector<HTMLElement>(`[data-attribute="${id}"] button:not([aria-label$="verschieben"])`)
    ?.focus()
}
async function closeSelected() {
  const id = selected.value?.id
  if (!id) return
  closing = id
  await go({ attribute: null })
  if (asking.value) return
  closing = null
  await nextTick()
  focusInPreview(id)
}

// From lg on the card stands beside the selected attribute: its top is the top of the selected field of the preview (or of the placeholder
// of a new one), and a small arrow at its left edge points at the middle of that field. It does not stick and is as high as its content; the
// page scrolls. Measured (not computed from the order) because the fields differ in height: after every change of the selection, the order
// and the view, and whenever the preview or the column changes size. offsetTop and offsetHeight ignore the transform of a field that is being
// dragged. Below lg the card lies under the preview, is as high as its content, and `reveal` scrolls to its beginning.
const left = useTemplateRef<HTMLElement>('left')
const right = useTemplateRef<HTMLElement>('right')
const cardTop = ref(0)
/** The middle of the selected field, from the top of the card; null while nothing is selected (no arrow). */
const arrowY = ref<number | null>(null)
function align() {
  const target = list.value?.querySelector<HTMLElement>('[aria-current="true"]')
  const column = left.value
  if (!target || !column) {
    cardTop.value = 0
    arrowY.value = null
    return
  }
  let top = 0
  for (
    let el: HTMLElement | null = target;
    el && el !== column;
    el = el.offsetParent as HTMLElement | null
  ) {
    top += el.offsetTop
  }
  cardTop.value = top
  arrowY.value = target.offsetHeight / 2
}
watch(
  () => [visible.value, query.value.attribute, newStep.value, !!livePreview.value, status.value],
  align,
  { flush: 'post' },
)
let observer: ResizeObserver | undefined
watch(
  [list, left],
  () => {
    observer?.disconnect()
    // jsdom has no ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(align)
      for (const element of [list.value, left.value]) if (element) observer.observe(element)
    }
    align()
  },
  { flush: 'post' },
)
onBeforeUnmount(() => observer?.disconnect())

const settings = useTemplateRef<{ focusFirstError: () => Promise<void>; focusHeading: () => void }>(
  'settings',
)
const isNarrow = () => window.matchMedia?.('(max-width: 1023px)').matches ?? false
async function reveal(next: Partial<AttributesQuery>) {
  await go(next)
  await nextTick()
  // The question "Änderungen verwerfen?" may have kept the page where it was
  if (query.value.attribute !== (next.attribute ?? null)) return
  // From lg on the watch below scrolls (to the field); only below the preview (narrow) the card has to be scrolled to
  if (!isNarrow()) return
  right.value?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
}
// From lg on every change of the selection (click, keyboard, the page loaded with it in the URL, a link, back and forward) scrolls the page
// so that the field starts under the header and the bar (`scroll-padding-top`, like any other scroll target); the card beside it starts
// there too. Smooth, at once with reduced motion. Only a selection that actually changes: while the question "Änderungen verwerfen?" holds
// it back nothing happens, and after "Anlegen" the new field is where its placeholder was, so the page stays.
// The browser would put the page back where it was for back, forward and reload, after this has scrolled: while this page is open the
// scrolling is done here.
const restoration = history.scrollRestoration
history.scrollRestoration = 'manual'
onBeforeUnmount(() => (history.scrollRestoration = restoration))
let createdId: string | null = null
watch(
  // One string: a new array each time would fire at every change of the attributes (after a move or a save), not of the selection
  () => `${status.value} ${isNew.value ? NEW_ATTRIBUTE : selected.value?.id}`,
  async () => {
    if (status.value !== 'ready' || isNarrow()) return
    if (selected.value && selected.value.id === createdId) {
      createdId = null
      return
    }
    // The bar of the results publishes its height (`--sticky-bar-height`, part of the scroll padding) after this watcher has run
    await nextTick()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    list.value
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
  },
  { flush: 'post' },
)
const select = (attribute: AdminAttribute) =>
  attribute.id === query.value.attribute ? undefined : reveal({ attribute: attribute.id })
const startNew = () => (isNew.value ? undefined : reveal({ attribute: NEW_ATTRIBUTE }))
const cancelNew = () => go({ attribute: null })

const viewButton = 'flex h-11 items-center rounded-lg border-2 px-3 text-base'
</script>

<template>
  <main class="py-8">
    <div class="page-column">
      <PageHeader title="Merkmale">
        Merkmale legen fest, was in der App erfasst wird, in der Reihenfolge der Vorschau. Die
        Reihenfolge änderst du per Ziehen, sie wird sofort gespeichert. Änderungen kommen beim
        nächsten Synchronisieren auf die Handys. Merkmale mit
        <LockIcon :size="14" class="inline-block align-[-2px]" aria-label="Schloss" /> sind
        Systemmerkmale: App und Berichte rechnen mit ihnen, deshalb änderst du hier nur Name,
        Beschreibung und Reihenfolge, alles andere ist im Code festgelegt.
      </PageHeader>

      <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div class="flex flex-col text-sm text-mute">
          <span :id="'view-label'">Vorschau für</span>
          <div class="mt-1 flex gap-3" role="group" aria-labelledby="view-label">
            <button
              v-for="[view, label] in [
                ['stem', 'Stamm'],
                ['beam', 'Balken'],
              ] as const"
              :key="view"
              type="button"
              :class="[
                viewButton,
                query.view === view
                  ? 'border-ink bg-paper font-bold text-ink'
                  : 'border-dim bg-transparent text-ink',
              ]"
              :aria-pressed="query.view === view"
              @click="selectView(view)"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <label class="flex h-11 items-center gap-3 text-base">
          <input
            type="checkbox"
            class="size-5 accent-ink"
            :checked="query.inactive"
            @change="setInactive(($event.target as HTMLInputElement).checked)"
          />
          Inaktive zeigen
        </label>
      </div>
    </div>

    <ResultsBar
      v-if="status === 'ready'"
      class="mt-4"
      :text="countAttributes(visible.length)"
      :chips="[]"
      :can-reset="false"
    >
      <template #status>
        <!-- Stays until the next try (an alert is read out by itself); the confirmation goes away after 3 seconds -->
        <p v-if="orderFailed" class="text-base font-semibold" role="alert">
          Die Reihenfolge konnte nicht gespeichert werden. Sie ist wieder wie vorher.
        </p>
        <p
          v-else-if="savedText"
          class="flex items-center gap-1.5 text-base text-mute"
          aria-hidden="true"
        >
          <CheckIcon :size="18" />
          {{ savedText }}
        </p>
      </template>
    </ResultsBar>

    <div class="page-column">
      <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
      <LoadingStatus v-else-if="status === 'loading'" role="status" />

      <div v-else class="mt-2 grid items-start gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
        <div ref="left" class="relative w-full max-w-[440px] max-lg:mx-auto">
          <p class="sr-only" role="status">{{ announcement }}</p>
          <!-- Like the table of the lists: padding of 8 px, lines (soft) only between the fields, ending 8 px short of the card's edge -->
          <div class="card p-2">
            <ul
              v-if="visible.length || isNew"
              ref="list"
              aria-label="Vorschau"
              class="divide-y divide-soft"
            >
              <li
                v-for="(attribute, index) in visible"
                :key="attribute.id"
                :data-attribute="attribute.id"
                :style="reorder.style(index)"
              >
                <AttributePreviewField
                  :attribute="attribute"
                  :selected="attribute.id === selected?.id"
                  :inherited="isInheritedOnly(attribute, query.view)"
                  movable
                  @select="select(attribute)"
                  @drag="reorder.start($event, index, items)"
                  @move="moveBy(index, $event)"
                />
              </li>
              <!-- The new attribute: a placeholder until type and name are there, then the attribute itself -->
              <li v-if="livePreview">
                <AttributePreviewField :attribute="livePreview" selected />
              </li>
              <li v-else-if="isNew">
                <!-- Built like a field (the name above, an empty input area of 52 px below), selected like one: the same padding and the grip in the
                     same place, but not movable. The area is dashed grey, without text or symbol, so that it does not look like a button. -->
                <div class="relative bg-paper py-0.5">
                  <div
                    class="flex flex-col gap-2.5 rounded-md bg-well py-5 pr-11 pl-11 ring-2 ring-ink ring-inset"
                    aria-current="true"
                    data-placeholder
                  >
                    <span class="text-label leading-6 font-bold text-mute"
                      >Unbenanntes Merkmal</span
                    >
                    <span
                      class="h-[52px] rounded-lg border-2 border-dashed border-lockline"
                      aria-hidden="true"
                    ></span>
                  </div>
                  <span
                    class="absolute top-1/2 left-0.5 flex size-10 -translate-y-1/2 items-center justify-center text-[#888] opacity-40 supports-[top:round(50%,1px)]:top-[round(50%,1px)]"
                    aria-hidden="true"
                  >
                    <GripVerticalIcon :size="22" />
                  </span>
                </div>
              </li>
            </ul>
            <p v-else class="p-5 text-mute">In dieser Ansicht gibt es keine Merkmale.</p>
          </div>
          <!-- Gone while a draft is open (the placeholder or the new field is in the card then, and the space below it goes too); below the card on the grey page, as wide as the card and as high as the big buttons of the preview (min-h-row, text-label, like "Foto aufnehmen") -->
          <button
            v-if="!isNew"
            type="button"
            class="mt-4 flex min-h-row w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-lockline text-label font-bold text-dim enabled:text-ink"
            @click="startNew"
          >
            <PlusIcon :size="22" :stroke-width="2.5" aria-hidden="true" />
            Merkmal hinzufügen
          </button>
        </div>

        <!-- As high as its content; from lg on it starts at the height of the selected field (`cardTop`), the arrow points at it -->
        <div
          ref="right"
          data-settings-column
          class="relative lg:mt-(--card-top)"
          :style="{ '--card-top': `${cardTop}px` }"
        >
          <AttributeTypePicker
            v-if="(isNew || selected) && newStep === 'type'"
            :title="isNew ? undefined : 'Typ ändern'"
            :current="draft ? tileOf(draft.type) : undefined"
            @pick="pickType"
            @cancel="isNew ? cancelNew() : (newStep = 'form')"
          />
          <AttributeSettings
            v-else-if="selected && draft"
            ref="settings"
            v-model="draft"
            :attribute="selected"
            :candidates="hidingCandidates(attributes, selected.id)"
            :errors="errors"
            :saving="saving"
            :failed="saveFailed"
            @save="save"
            @reset="resetDraft"
            @close="closeSelected"
            @change-type="newStep = 'type'"
          />
          <AttributeSettings
            v-else-if="isNew && draft"
            ref="settings"
            v-model="draft"
            :attribute="null"
            :candidates="hidingCandidates(attributes, NEW_ATTRIBUTE)"
            :errors="errors"
            :saving="saving"
            :failed="saveFailed"
            @save="save"
            @cancel="cancelNew"
            @change-type="newStep = 'type'"
          />
          <!-- The same display as "Waldesruh" in the lists, in the place of the settings (the column keeps its width and its place at the top) -->
          <StatusCard
            v-else
            title="Nichts ausgewählt"
            text-class="md:whitespace-nowrap"
            role="status"
          >
            <template #icon>
              <MousePointerClickIcon
                :size="96"
                :stroke-width="1.5"
                class="text-ink"
                aria-hidden="true"
              />
            </template>
            <template #text>Merkmal zum Bearbeiten auswählen oder ein neues anlegen.</template>
            <!-- The same as the button under the preview, in the style of the other outlined buttons (like "Verwerfen"), as wide as its content -->
            <button
              type="button"
              class="mt-2 flex h-11 items-center gap-2 rounded-lg border-2 border-ink px-4 font-bold whitespace-nowrap"
              @click="startNew"
            >
              <PlusIcon :size="18" aria-hidden="true" />
              Merkmal hinzufügen
            </button>
          </StatusCard>
          <!-- A square turned by 45° whose left and lower edge are the card's frame; the other half lies on the card and hides its frame there -->
          <span
            v-if="arrowY !== null && (isNew || selected)"
            data-card-arrow
            class="absolute -left-[7px] hidden size-3.5 rotate-45 border-b border-l border-line bg-paper lg:block"
            :style="{ top: `${arrowY - 7}px` }"
            aria-hidden="true"
          ></span>
        </div>
      </div>
    </div>

    <DiscardDialog v-model:open="asking" @discard="discard" />
  </main>
</template>
