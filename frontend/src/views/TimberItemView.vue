<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRouter,
  type RouteLocationRaw,
} from 'vue-router'
import { useTimberItemStore } from '@/stores/timberItems'
import type { AttributeValue } from '@/api/contract'
import { collectDraft, type DraftInput } from '@/utils/attributeDraft'
import { bySortOrder } from '@/utils/sort'
import { useToast } from '@/composables/useToast'
import TimberItemHeader from '@/components/TimberItemHeader.vue'
import TimberItemStatus from '@/components/TimberItemStatus.vue'
import ChoiceAttributeField from '@/components/ChoiceAttributeField.vue'
import BooleanAttributeField from '@/components/BooleanAttributeField.vue'
import DateAttributeField from '@/components/DateAttributeField.vue'
import NumberAttributeField from '@/components/NumberAttributeField.vue'
import TextAttributeField from '@/components/TextAttributeField.vue'
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
const parent = computed(() => store.items.find((candidate) => candidate.id === item.value?.parent_id))
const beams = computed(() => (item.value ? store.childrenOf(item.value.id) : []))
const kind = computed(() => (parent.value ? 'Balken' : 'Stamm'))
// Split into beams: the values stay visible, but nothing can be recorded any more.
const isSplit = computed(() => item.value?.has_children ?? false)

// Fields in the order V29 set. Types without a field (photo) are skipped by the v-if chain in the template.
// Inactive attributes stay visible only for an existing value (the snapshot keeps them for that), read-only.
const attributes = computed(() =>
  store.attributes
    .filter((attribute) => attribute.active || item.value?.values[attribute.id])
    .sort(bySortOrder),
)

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
  () => changes.value.length > 0 || Object.keys(collected.value.errors).length > 0,
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

const saveLabel = computed(() => (item.value ? 'Speichern' : 'Stamm anlegen & speichern'))

async function onSave() {
  const errorIds = Object.keys(collected.value.errors)
  if (errorIds.length > 0) {
    failedInputs.value = Object.fromEntries(errorIds.map((id) => [id, draft.value[id]]))
    // The save bar sticks to the bottom; without this the error may be off screen and "nothing happens".
    await nextTick()
    document.querySelector('[role="alert"]')?.scrollIntoView({ block: 'center' })
    return
  }
  // Take the list before writing: afterwards the draft equals the store and `changes` would be empty.
  const toSave = changes.value
  const isNew = !item.value
  // Like the click prototype: a new item is created even without values.
  // Only plain tags get here without an item: unknown beams are sent back by the router guard.
  const target = item.value ?? store.createTimberItem(Number(props.tagNumber))
  for (const change of toSave) {
    store.recordAttribute(target.id, change.attributeId, change.value)
  }

  const hasSaved = isNew || toSave.length > 0
  toast.show(
    hasSaved
      ? { before: kind.value, tagNumber: props.tagNumber, after: 'gespeichert' }
      : { before: `Keine Änderungen an ${kind.value}`, tagNumber: props.tagNumber },
  )

  draft.value = {}
  added.value = {}
  failedInputs.value = {}
  formKey.value++
}

// --- Beams ---------------------------------------------------------------
function onAddBeam() {
  // Adding a beam locks this item, so unsaved input could never be saved afterwards.
  if (isDirty.value) {
    toast.show({ before: 'Bitte erst speichern oder Eingaben verwerfen' })
    return
  }
  const beam = store.addBeam(item.value!.id)
  toast.show({ before: 'Balken', tagNumber: beam.tag_number!, after: 'angelegt' })
  router.push({ name: 'timber-item', params: { tagNumber: beam.tag_number } })
}

const isRemoveAsked = ref(false)

async function onRemove() {
  isRemoveAsked.value = false
  const beamId = item.value!.id
  // Leave first: removing it while the screen is still open would flash "Noch nicht erfasst".
  isLeaveConfirmed = true
  await router.push({ name: 'timber-item', params: { tagNumber: parent.value!.tag_number } })
  store.removeTimberItem(beamId)
  toast.show({ before: 'Balken', tagNumber: props.tagNumber, after: 'entfernt' })
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

    <TimberItemStatus :item="item" />

    <RouterLink
      v-if="parent?.tag_number"
      :to="{ name: 'timber-item', params: { tagNumber: parent.tag_number } }"
      class="mx-gutter mb-2 font-semibold underline"
    >
      Aus Stamm <FormattedTag :tag-number="parent.tag_number" />
    </RouterLink>
    <p v-if="isSplit" class="mx-gutter mb-2 text-sm">
      In Balken aufgeteilt – Werte sind nicht mehr änderbar.
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
      </template>
    </div>

    <!-- Beams are cut from a stem only, never from another beam. -->
    <section v-if="item && !parent" class="flex flex-col gap-2.5 py-3.5 px-gutter">
      <h2 class="text-[17px] font-bold">Balken</h2>
      <RouterLink
        v-for="beam in beams"
        :key="beam.id"
        :to="{ name: 'timber-item', params: { tagNumber: beam.tag_number } }"
        class="flex min-h-11 items-center rounded-lg border-2 border-line px-3 font-semibold"
      >
        <FormattedTag :tag-number="beam.tag_number!" />
      </RouterLink>
      <button
        type="button"
        class="h-14 w-full rounded-lg border-2 border-ink bg-paper text-[17px] font-bold"
        @click="onAddBeam"
      >
        Balken hinzufügen
      </button>
    </section>

    <section v-if="item && store.canRemove(item.id)" class="py-3.5 px-gutter">
      <button
        type="button"
        class="h-14 w-full rounded-lg border-2 border-ink bg-paper text-[17px] font-bold"
        @click="isRemoveAsked = true"
      >
        Balken entfernen
      </button>
    </section>

    <!-- Pushes the save bar down when the content is shorter than the screen. -->
    <div class="flex-auto"></div>

    <SaveBar v-if="!isSplit" :label="saveLabel" @save="onSave" />

    <ConfirmSheet
      v-if="isRemoveAsked"
      title="Balken entfernen?"
      primary-label="Behalten"
      secondary-label="Entfernen"
      @primary="isRemoveAsked = false"
      @secondary="onRemove"
    >
      <p>
        Balken <FormattedTag :tag-number="tagNumber" /> ist noch nicht synchronisiert und wird
        mit allen Werten gelöscht.
      </p>
    </ConfirmSheet>

    <ConfirmSheet
      v-if="pendingLeave"
      title="Änderungen verwerfen?"
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
