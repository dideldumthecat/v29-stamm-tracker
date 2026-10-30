<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRouter,
  type RouteLocationRaw,
} from 'vue-router'
import { ChevronRightIcon, PlusIcon, TagIcon, Trash2Icon } from '@lucide/vue'
import { useTimberItemStore, type TimberItem } from '@/stores/timberItems'
import type { AttributeValue } from '@/api/contract'
import { collectDraft, formatValue, type DraftInput } from '@/utils/attributeDraft'
import { attachPhotos } from '@/utils/photo'
import { bySortOrder } from '@/utils/sort'
import { MAX_BEAMS } from '@/config/constants'
import { useToast } from '@/composables/useToast'
import TimberItemHeader from '@/components/TimberItemHeader.vue'
import TimberItemStatus from '@/components/TimberItemStatus.vue'
import ChoiceAttributeField from '@/components/ChoiceAttributeField.vue'
import BooleanAttributeField from '@/components/BooleanAttributeField.vue'
import DateAttributeField from '@/components/DateAttributeField.vue'
import MonthAttributeField from '@/components/MonthAttributeField.vue'
import NumberAttributeField from '@/components/NumberAttributeField.vue'
import TextAttributeField from '@/components/TextAttributeField.vue'
import PhotoSection from '@/components/PhotoSection.vue'
import SaveBar from '@/components/SaveBar.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import FormattedTag from '@/components/FormattedTag.vue'

const props = defineProps<{
  // Tag from the URL, e.g. "85" or a beam's "85-A". Passed in by the router (`props: true`).
  // Route params are always strings; the router guard has already validated it.
  tagNumber: string
}>()

const router = useRouter()
const store = useTimberItemStore()
const toast = useToast()

const item = computed(() => store.findByTag(props.tagNumber))
const parent = computed(() =>
  store.items.find((candidate) => candidate.id === item.value?.parent_id),
)
const beams = computed(() => (item.value ? store.childrenOf(item.value.id) : []))
const parentTag = computed(() => parent.value?.tag_number ?? undefined)
const kind = computed(() => (parent.value ? 'Balken' : 'Stamm'))
// Split into beams: the values stay visible, but nothing can be recorded any more.
const isSplit = computed(() => item.value?.has_children ?? false)

// Fields in the order V29 set.
// Read-only attributes (inactive, or all on a split stem) stay visible only for an existing value.
const attributes = computed(() =>
  store.attributes
    .filter((attribute) => (attribute.active && !isSplit.value) || item.value?.values[attribute.id])
    .sort(bySortOrder),
)

// Photos taken or picked but not saved yet: held in memory like any field, so a crash loses them.
// `id` only keys the preview; the store gives the saved photo its own.
const draftPhotos = ref<{ id: string; attributeId: string; blob: Blob }[]>([])

// Raw input per attribute id (see DraftInput). Only touched attributes have an entry.
const draft = ref<Record<string, DraftInput | undefined>>({})
// Series only: values already added with "Hinzufügen".
const added = ref<Record<string, AttributeValue[]>>({})

// The draft holds string | boolean; fields read it through the accessor of their type.
// (A cast in the template would trip the Vue lint rule, which reads `|` as a filter.)
function draftText(attributeId: string): string | undefined {
  return draft.value[attributeId] as string | undefined
}

function draftFlag(attributeId: string): boolean | undefined {
  return draft.value[attributeId] as boolean | undefined
}

// Incremented after saving to remount the fields: resets their local "unlocked" state.
const formKey = ref(0)

// Draft values that differ from what is recorded, plus input that cannot be recorded yet.
const collected = computed(() =>
  collectDraft(store.attributes, draft.value, added.value, item.value?.values),
)
const changes = computed(() => collected.value.changes)
// Invalid input counts as unsaved, so the leave dialog still protects it.
const isDirty = computed(
  () =>
    changes.value.length > 0 ||
    Object.keys(collected.value.errors).length > 0 ||
    draftPhotos.value.length > 0,
)

// An error appears only after a failed save and disappears once the input changes (as in the click prototype):
// remember the input each error was shown for.
const failedInputs = ref<Record<string, DraftInput | undefined>>({})
const shownErrors = computed(() =>
  Object.fromEntries(
    Object.entries(collected.value.errors).filter(
      ([id]) => id in failedInputs.value && failedInputs.value[id] === draft.value[id],
    ),
  ),
)

const saveLabel = computed(() =>
  item.value ? 'Speichern & schließen' : 'Stamm anlegen & schließen',
)

// Records the draft and resets the form. null = invalid input blocks it; the errors are shown.
// Only called with something to save: a dirty draft or a stem not recorded yet.
async function saveDraft(): Promise<TimberItem | null> {
  const errorIds = Object.keys(collected.value.errors)
  if (errorIds.length > 0) {
    failedInputs.value = Object.fromEntries(errorIds.map((id) => [id, draft.value[id]]))
    // The save bar sticks to the bottom; without this the error may be off screen and "nothing happens".
    await nextTick()
    document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center' })
    return null
  }
  // Take the lists before writing: afterwards the draft equals the store and `changes` would be empty.
  const toSave = changes.value
  const photosToSave = draftPhotos.value
  // Like the click prototype: a new item is created even without values.
  // Only plain tags get here without an item: unknown beams are sent back by the router guard.
  // One transaction: a crash must not leave a photo without its stem or a stem without its photo.
  const target = store.inOneTransaction(() => {
    const target = item.value ?? store.createTimberItem(Number(props.tagNumber))
    for (const change of toSave) {
      store.recordAttribute(target.id, change.attributeId, change.value)
    }
    for (const photo of photosToSave) {
      store.addPhoto(target.id, photo.attributeId, photo.blob)
    }
    return target
  })

  draft.value = {}
  added.value = {}
  draftPhotos.value = []
  failedInputs.value = {}
  formKey.value++
  return target
}

// Saving closes the item: a beam goes back to its stem, a stem to the start screen.
async function onSave() {
  if (await saveDraft()) {
    toast.show({ before: kind.value, tagNumber: props.tagNumber, after: 'gespeichert' })
    await router.push(
      parent.value
        ? { name: 'timber-item', params: { tagNumber: parent.value.tag_number } }
        : { name: 'start' },
    )
  }
}

// --- Photos --------------------------------------------------------------
// Taken or picked photos are compressed and join the draft; they are stored with "Speichern & schließen".
const isCompressing = ref(false)

async function onAddPhotos(attributeId: string, files: File[]) {
  isCompressing.value = true
  try {
    const { skipped } = await attachPhotos(files, (blob) => {
      draftPhotos.value.push({ id: crypto.randomUUID(), attributeId, blob })
    })
    if (skipped > 0) {
      toast.show({
        before: `${skipped} ${skipped === 1 ? 'Foto konnte' : 'Fotos konnten'} nicht gelesen werden`,
        kind: 'warning',
      })
    }
  } finally {
    isCompressing.value = false
  }
}

// Previews of the attribute: saved photos not uploaded yet, then the draft ones.
// Saved photos are removable only while their event is still queued.
function photosOf(attributeId: string) {
  return [
    ...(item.value ? store.pendingPhotosOf(item.value.id) : []).map((photo) => ({
      photo,
      removable: store.isPhotoQueued(photo.id),
    })),
    ...draftPhotos.value
      .filter((photo) => photo.attributeId === attributeId)
      .map((photo) => ({ photo, removable: true })),
  ]
}

const photoToRemove = ref<string | null>(null)

function onRemovePhoto() {
  const id = photoToRemove.value!
  photoToRemove.value = null
  if (draftPhotos.value.some((photo) => photo.id === id)) {
    draftPhotos.value = draftPhotos.value.filter((photo) => photo.id !== id)
  } else {
    store.removePhoto(id)
  }
}

// --- Beams ---------------------------------------------------------------
const nextBeam = computed(() => store.nextBeamTagOf(item.value, props.tagNumber))

// First two own values in the order V29 set; inherited ones are the stem's, not worth repeating.
function beamSummary(beam: TimberItem): string {
  const parts = [...store.attributes]
    .sort(bySortOrder)
    .filter((attribute) => beam.values[attribute.id] && !store.isInherited(beam.id, attribute.id))
    .map((attribute) => formatValue(attribute, beam.values[attribute.id]!.slice(-1)[0]!.value))
    .filter((text) => text !== null)
    .slice(0, 2)
  return parts.length > 0 ? parts.join(' · ') : 'noch keine eigenen Angaben'
}

async function onAddBeam() {
  // Save first: once split, the stem is read-only and the draft could never be saved.
  const saved = isDirty.value ? await saveDraft() : undefined
  if (saved === null) {
    return
  }
  // Like the click prototype: a stem not recorded yet is created by its first beam.
  // No toast: the new beam appears in the list right away.
  const stem = saved ?? item.value ?? store.createTimberItem(Number(props.tagNumber))
  store.addBeam(stem.id)
}

const beamToRemove = ref<TimberItem | null>(null)
// Own recordings only: `store.items` holds no inherited values.
const ownRecordingCount = computed(
  () =>
    Object.values(
      store.items.find((candidate) => candidate.id === beamToRemove.value?.id)?.values ?? {},
    ).flat().length,
)

async function onRemove() {
  const beam = beamToRemove.value!
  beamToRemove.value = null
  if (beam.id === item.value?.id) {
    // Leave first: removing it while the screen is still open would flash "Noch nicht erfasst".
    isLeaveConfirmed = true
    await router.push({ name: 'timber-item', params: { tagNumber: parent.value!.tag_number } })
  }
  store.removeTimberItem(beam.id)
  toast.show({ before: 'Balken', tagNumber: beam.tag_number!, after: 'entfernt' })
}

// --- Leaving with unsaved changes ---------------------------------------
// The guard covers every way out: close button, browser/system back gesture.
const pendingLeave = ref<RouteLocationRaw | null>(null)
let isLeaveConfirmed = false

// Parent ↔ beam stays on the same route, which counts as an update, not a leave.
function guardLeave(to: { fullPath: string }) {
  if (isLeaveConfirmed || !isDirty.value) {
    return true
  }
  pendingLeave.value = to.fullPath
  return false
}
onBeforeRouteLeave(guardLeave)
onBeforeRouteUpdate(guardLeave)

function onClose() {
  router.push({ name: 'start' })
}

function onKeepEditing() {
  pendingLeave.value = null
}

// "2 Fotos und 1 Änderung": only the parts that exist.
const discardSummary = computed(() => {
  const photoCount = draftPhotos.value.length
  const fieldCount = changes.value.length + Object.keys(collected.value.errors).length
  return [
    photoCount > 0 && `${photoCount} ${photoCount === 1 ? 'Foto' : 'Fotos'}`,
    fieldCount > 0 && `${fieldCount} ${fieldCount === 1 ? 'Änderung' : 'Änderungen'}`,
  ]
    .filter(Boolean)
    .join(' und ')
})

function onDiscard() {
  const target = pendingLeave.value
  pendingLeave.value = null
  isLeaveConfirmed = true
  if (target) {
    router.push(target)
  }
}
</script>

<template>
  <!-- Scroll container of this screen; header and save bar stick to its edges. -->
  <div class="flex min-h-0 flex-col overflow-y-auto">
    <TimberItemHeader
      :tag-number="tagNumber"
      :kind="kind.toUpperCase()"
      :pending-count="store.pendingCount"
      @close="onClose"
    />

    <TimberItemStatus :item="item" :parent-tag="parentTag" />

    <!-- Beams are cut from a stem only, never from another beam. -->
    <section
      v-if="!parent"
      class="flex flex-col gap-2.5 border-t border-line py-3.5 px-gutter *:max-w-full *:min-w-0"
    >
      <h2 class="flex items-center gap-2 text-[17px] font-bold">
        Balken<template v-if="beams.length > 0"> ({{ beams.length }})</template>
      </h2>
      <div v-if="beams.length > 0">
        <div
          v-for="beam in beams"
          :key="beam.id"
          class="flex items-center gap-2 border-b border-line"
        >
          <RouterLink
            :to="{ name: 'timber-item', params: { tagNumber: beam.tag_number } }"
            class="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
          >
            <strong class="text-xl whitespace-nowrap tabular-nums"
              ><FormattedTag :tag-number="beam.tag_number!"
            /></strong>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px] text-mute">
              <span>{{ beamSummary(beam) }}</span>
              <span v-if="store.canRemove(beam.id)">nicht synchronisiert</span>
            </span>
            <ChevronRightIcon :size="22" aria-hidden="true" />
          </RouterLink>
          <button
            v-if="store.canRemove(beam.id)"
            type="button"
            class="flex size-11 shrink-0 items-center justify-center rounded-md border-2 border-ink bg-paper text-ink"
            :aria-label="`Balken ${beam.tag_number} entfernen`"
            @click="beamToRemove = beam"
          >
            <Trash2Icon :size="20" :stroke-width="2.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <button
        type="button"
        class="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink bg-paper text-[17px] font-bold disabled:border-lockline disabled:text-mute"
        :disabled="!nextBeam"
        @click="onAddBeam"
      >
        <PlusIcon :size="22" :stroke-width="2.5" aria-hidden="true" />
        <span v-if="nextBeam">Balken <FormattedTag :tag-number="nextBeam" /> hinzufügen</span>
        <span v-else>Balken hinzufügen</span>
      </button>
      <span v-if="!nextBeam" class="text-[13px] text-mute"
        >Höchstens {{ MAX_BEAMS }} Balken je Stamm</span
      >
      <p v-if="beams.length === 0" class="text-sm leading-[1.4] text-body">
        Nur wenn der Stamm in mehrere Balken gesägt wird: je Balken einmal tippen und die Kennung
        mit Filzstift auf den Balken schreiben. Angaben, die für alle Balken gelten, vorher am Stamm
        erfassen – danach ist der Stamm gesperrt.
      </p>
      <span v-if="beams.some((beam) => !store.canRemove(beam.id))" class="text-[13px] text-mute"
        >Übertragene Balken kann nur die Administration entfernen.</span
      >
    </section>

    <p v-if="isSplit" class="my-2 mx-gutter rounded-lg bg-well p-3 text-sm leading-[1.4]">
      Aufgeteilter Stamm: Angaben am jeweiligen Balken erfassen.
    </p>

    <div :key="formKey" class="border-b border-line">
      <template v-for="attribute in attributes" :key="attribute.id">
        <ChoiceAttributeField
          v-if="attribute.type === 'choice'"
          :model-value="draftText(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          @update:model-value="draft[attribute.id] = $event"
        />
        <BooleanAttributeField
          v-else-if="attribute.type === 'boolean'"
          :model-value="draftFlag(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          @update:model-value="draft[attribute.id] = $event"
        />
        <DateAttributeField
          v-else-if="attribute.type === 'date'"
          :model-value="draftText(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          @update:model-value="draft[attribute.id] = $event"
        />
        <MonthAttributeField
          v-else-if="attribute.type === 'month'"
          :model-value="draftText(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          :error="shownErrors[attribute.id]"
          @update:model-value="draft[attribute.id] = $event"
        />
        <NumberAttributeField
          v-else-if="attribute.type === 'number'"
          :model-value="draftText(attribute.id)"
          :added="added[attribute.id]"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          :error="shownErrors[attribute.id]"
          @update:model-value="draft[attribute.id] = $event"
          @update:added="added[attribute.id] = $event"
        />
        <TextAttributeField
          v-else-if="attribute.type === 'text'"
          :model-value="draftText(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          @update:model-value="draft[attribute.id] = $event"
        />
        <PhotoSection
          v-else-if="attribute.type === 'photo'"
          :attribute="attribute"
          :pending="photosOf(attribute.id)"
          :uploaded-count="item ? store.uploadedPhotoCount(item.id, attribute.id) : 0"
          :can-capture="attribute.active && !isSplit"
          :busy="isCompressing"
          @add="onAddPhotos(attribute.id, $event)"
          @remove="photoToRemove = $event"
        />
      </template>
    </div>

    <!-- A removable beam is never split, so both actions share this section. -->
    <section v-if="item && !isSplit" class="flex flex-col gap-3.5 py-3.5 px-gutter">
      <!-- Replace: the retag screen comes back with replace as well, so back never reaches the old tag. -->
      <button
        type="button"
        class="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-ink bg-paper text-[17px] font-bold"
        @click="router.replace({ name: 'retag', params: { tagNumber } })"
      >
        <TagIcon :size="22" :stroke-width="2.5" aria-hidden="true" />
        Plakette ändern
      </button>
      <button
        v-if="store.canRemove(item.id)"
        type="button"
        class="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-ink bg-paper text-[17px] font-bold"
        @click="beamToRemove = item"
      >
        <Trash2Icon :size="22" :stroke-width="2.5" aria-hidden="true" />
        Balken entfernen
      </button>
    </section>

    <!-- Pushes the save bar down when the content is shorter than the screen. -->
    <div class="flex-auto"></div>

    <!-- A stem not recorded yet can always be saved: creating it is the change.
         A split stem is read-only, so the bar only leads back to the start screen. -->
    <SaveBar
      :label="isSplit ? 'Zurück zum Start' : saveLabel"
      :disabled="isCompressing || (!isSplit && !!item && !isDirty)"
      @save="isSplit ? onClose() : onSave()"
    />

    <!-- Wording as in the click prototype (confirmRemoveBeam). -->
    <ConfirmSheet
      v-if="beamToRemove"
      primary-label="Abbrechen"
      secondary-label="Balken entfernen"
      emphasize-secondary
      @primary="beamToRemove = null"
      @secondary="onRemove"
    >
      <template #title>
        Balken <FormattedTag :tag-number="beamToRemove.tag_number!" /> entfernen?
      </template>
      <p>
        <template v-if="ownRecordingCount === 1">Seine Angabe wird mit entfernt. </template>
        <template v-else-if="ownRecordingCount > 1"
          >Seine {{ ownRecordingCount }} Angaben werden mit entfernt.
        </template>
        Die Kennung <FormattedTag :tag-number="beamToRemove.tag_number!" /> wird nicht neu vergeben,
        der nächste Balken bekommt den nächsten Buchstaben.
      </p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="photoToRemove"
      title="Foto entfernen?"
      primary-label="Abbrechen"
      secondary-label="Foto entfernen"
      emphasize-secondary
      @primary="photoToRemove = null"
      @secondary="onRemovePhoto"
    >
      <p>Das Foto ist noch nicht hochgeladen und wird vom Gerät gelöscht.</p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="pendingLeave"
      :title="`${discardSummary} verwerfen?`"
      primary-label="Weiter bearbeiten"
      secondary-label="Verwerfen"
      @primary="onKeepEditing"
      @secondary="onDiscard"
    >
      <p>
        Deine Eingaben für {{ kind }} <FormattedTag :tag-number="tagNumber" /> sind noch nicht
        gespeichert.
      </p>
    </ConfirmSheet>
  </div>
</template>
