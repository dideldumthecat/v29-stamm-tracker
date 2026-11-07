<script setup lang="ts">
import { computed, nextTick, ref, type Component } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRouter,
  type RouteLocationRaw,
} from 'vue-router'
import { Trash2Icon } from '@lucide/vue'
import { useTimberItemStore, type Attribute, type TimberItem } from '@/stores/timberItems'
import type { AttributeValue } from '@v29/shared/contract'
import { formatPhotoCount, formatValueLine } from '@/utils/attributeDraft'
import { bySortOrder } from '@/utils/sort'
import { useToast } from '@/composables/useToast'
import { useTimberItemDraft } from '@/composables/useTimberItemDraft'
import TimberItemHeader from '@/components/TimberItemHeader.vue'
import TimberItemStatus from '@/components/TimberItemStatus.vue'
import ChoiceAttributeField from '@/components/ChoiceAttributeField.vue'
import BooleanAttributeField from '@/components/BooleanAttributeField.vue'
import DateAttributeField from '@/components/DateAttributeField.vue'
import MonthAttributeField from '@/components/MonthAttributeField.vue'
import NumberAttributeField from '@/components/NumberAttributeField.vue'
import TextAttributeField from '@/components/TextAttributeField.vue'
import PhotoSection from '@/components/PhotoSection.vue'
import BeamList from '@/components/BeamList.vue'
import SaveBar from '@/components/SaveBar.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import FormattedTag from '@v29/shared/FormattedTag.vue'

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

const fieldComponents: Partial<Record<Attribute['type'], Component>> = {
  choice: ChoiceAttributeField,
  boolean: BooleanAttributeField,
  date: DateAttributeField,
  month: MonthAttributeField,
  number: NumberAttributeField,
  text: TextAttributeField,
}

const {
  draft,
  added,
  draftBeams,
  formKey,
  isDirty,
  shownErrors,
  isCompressing,
  isPicking,
  addPhotos,
  photosOf,
  removePhoto,
  unsaved,
  save,
} = useTimberItemDraft(item, () => props.tagNumber, attributes)

// Only where the component has them: an unknown prop would end up as an HTML attribute.
function extraProps(attribute: Attribute) {
  const error = shownErrors.value[attribute.id]
  if (attribute.type === 'month') {
    return { error }
  }
  if (attribute.type === 'number') {
    return {
      error,
      added: added.value[attribute.id],
      'onUpdate:added': (values: AttributeValue[]) => (added.value[attribute.id] = values),
    }
  }
  return {}
}

// A split stem is read-only; the bar only leads back to the start screen, unless new beams wait to be saved.
const isClosing = computed(() => isSplit.value && draftBeams.value.length === 0)

// A stem saved with new beams stays open (the beams are the next step); anything else closes.
const saveLabel = computed(
  () =>
    `${item.value ? 'Speichern' : 'Stamm anlegen'}${draftBeams.value.length > 0 ? '' : ' & schließen'}`,
)

async function saveDraft(): Promise<TimberItem | null> {
  const target = save()
  if (!target) {
    // The save bar sticks to the bottom; without this the error may be off screen and "nothing happens".
    await nextTick()
    document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center' })
  }
  return target
}

// Saving closes the item: a beam goes back to its stem, a stem to the start screen.
// Not a stem with new beams: it stays, where the beams are listed.
async function onSave() {
  const staysOpen = draftBeams.value.length > 0
  if (await saveDraft()) {
    toast.show({ before: kind.value, tagNumber: props.tagNumber, after: 'gespeichert' })
    if (!staysOpen) {
      await router.push(
        parent.value
          ? { name: 'timber-item', params: { tagNumber: parent.value.tag_number } }
          : { name: 'start' },
      )
    }
  }
}

const photoToRemove = ref<string | null>(null)

function onRemovePhoto() {
  const id = photoToRemove.value!
  photoToRemove.value = null
  removePhoto(id)
}

// Set when a beam cannot be opened before the stem is saved.
const beamToOpen = ref<string | null>(null)

// Only saves and stays: the beam is a normal link now, opened by tapping it again.
async function onSaveBeforeOpen() {
  beamToOpen.value = null
  if (await saveDraft()) {
    toast.show({ before: kind.value, tagNumber: props.tagNumber, after: 'gespeichert' })
  }
}

const beamToRemove = ref<TimberItem | null>(null)

// What the remove dialog lists: the beam's own values (`store.items` holds no inherited ones) in the
// order of the form, then its photos, uploaded or not. Photos are told apart by the attribute type.
const removeLines = computed(() => {
  const own = store.items.find((candidate) => candidate.id === beamToRemove.value?.id)?.values ?? {}
  const values: string[] = []
  let photoCount = 0
  for (const attribute of [...store.attributes].sort(bySortOrder)) {
    const recorded = own[attribute.id] ?? []
    if (attribute.type === 'photo') {
      photoCount += recorded.length
    } else {
      // Only a series keeps more than its latest value.
      for (const record of attribute.is_series ? recorded : recorded.slice(-1)) {
        values.push(formatValueLine(attribute, record.value))
      }
    }
  }
  return photoCount > 0 ? [...values, formatPhotoCount(photoCount)] : values
})

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
    <BeamList
      v-if="!parent"
      v-model:draft-beams="draftBeams"
      :stem="item"
      :tag-number="tagNumber"
      :is-dirty="isDirty"
      @save-first="beamToOpen = $event"
      @remove="beamToRemove = $event"
    />

    <p v-if="isSplit" class="my-2 mx-gutter rounded-lg bg-well p-3 text-sm leading-copy">
      Aufgeteilter Stamm: Angaben am jeweiligen Balken erfassen.
    </p>

    <div :key="formKey" class="border-b border-line">
      <template v-for="attribute in attributes" :key="attribute.id">
        <PhotoSection
          v-if="attribute.type === 'photo'"
          :attribute="attribute"
          :pending="photosOf(attribute.id)"
          :uploaded-count="item ? store.uploadedPhotoCount(item.id, attribute.id) : 0"
          :can-capture="attribute.active && !isSplit"
          :busy="isCompressing"
          @add="addPhotos(attribute.id, $event)"
          @picker="isPicking = $event"
          @remove="photoToRemove = $event"
        />
        <component
          :is="fieldComponents[attribute.type]"
          v-else-if="attribute.type in fieldComponents"
          :model-value="draft[attribute.id]"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :readonly="!attribute.active || isSplit"
          :inherited="item && store.isInherited(item.id, attribute.id)"
          :user-name="store.userName"
          v-bind="extraProps(attribute)"
          @update:model-value="draft[attribute.id] = $event"
        />
      </template>
    </div>

    <section v-if="item && !isSplit && parent" class="py-section px-gutter">
      <button
        type="button"
        class="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-ink bg-paper text-heading font-bold"
        @click="beamToRemove = item"
      >
        <Trash2Icon :size="22" :stroke-width="2.5" aria-hidden="true" />
        Balken entfernen
      </button>
    </section>

    <!-- Pushes the save bar down when the content is shorter than the screen. -->
    <div class="flex-auto"></div>

    <!-- A stem not recorded yet can always be saved: creating it is the change.
         A split stem is read-only, so the bar only leads back to the start screen, unless it has draft beams. -->
    <SaveBar
      :label="isClosing ? 'Zurück zum Start' : saveLabel"
      :disabled="isCompressing || (!isClosing && !!item && !isDirty)"
      @save="isClosing ? onClose() : onSave()"
    />

    <!-- Wording as in the click prototype (confirmRemoveBeam). -->
    <ConfirmSheet
      v-if="beamToRemove"
      safe-label="Abbrechen"
      action-label="Balken entfernen"
      emphasize-action
      @safe="beamToRemove = null"
      @action="onRemove"
    >
      <template #title>
        Balken <FormattedTag :tag-number="beamToRemove.tag_number!" /> entfernen?
      </template>
      <template v-if="removeLines.length > 0">
        <p>Wird mit entfernt:</p>
        <ul class="mt-1 mb-2 list-disc pl-5">
          <li v-for="(line, index) in removeLines" :key="index">{{ line }}</li>
        </ul>
      </template>
      <p>
        <template v-if="!store.isUnsynced(beamToRemove.id)"
          >Er wird beim nächsten Synchronisieren auch auf dem Server entfernt.
        </template>
        Der Buchstabe {{ beamToRemove.tag_number!.slice(-1) }} wird wieder frei und kann für einen
        neuen Balken vergeben werden.
      </p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="beamToOpen"
      title="Erst speichern?"
      safe-label="Abbrechen"
      action-label="Speichern"
      emphasize-action
      @safe="beamToOpen = null"
      @action="onSaveBeforeOpen"
    >
      <p>
        Dein Stand für {{ kind }} <FormattedTag :tag-number="tagNumber" /> ist noch nicht
        gespeichert. Erst danach lässt sich der Balken öffnen.
      </p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="photoToRemove"
      title="Foto entfernen?"
      safe-label="Abbrechen"
      action-label="Foto entfernen"
      emphasize-action
      @safe="photoToRemove = null"
      @action="onRemovePhoto"
    >
      <p>Das Foto ist noch nicht hochgeladen und wird vom Gerät gelöscht.</p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="pendingLeave"
      title="Änderungen verwerfen?"
      safe-label="Weiter bearbeiten"
      action-label="Verwerfen"
      @safe="onKeepEditing"
      @action="onDiscard"
    >
      <p>Noch nicht gespeichert für {{ kind }} <FormattedTag :tag-number="tagNumber" />:</p>
      <ul class="mt-1 list-disc pl-5">
        <li v-for="line in unsaved.fields" :key="line">{{ line }}</li>
        <li v-if="unsaved.beams.length > 0">
          Balken
          <template v-for="(tag, index) in unsaved.beams" :key="tag"
            ><template v-if="index > 0">, </template><FormattedTag :tag-number="tag"
          /></template>
        </li>
        <li v-if="unsaved.photos">{{ unsaved.photos }}</li>
      </ul>
    </ConfirmSheet>
  </div>
</template>
