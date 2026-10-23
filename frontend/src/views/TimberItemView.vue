<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { onBeforeRouteLeave, useRouter, type RouteLocationRaw } from 'vue-router'
import { useTimberItemStore } from '@/stores/timberItems'
import type { AttributeValue } from '@/api/contract'
import { collectDraft, type DraftInput } from '@/utils/attributeDraft'
import { useToast } from '@/composables/useToast'
import TimberItemHeader from '@/components/TimberItemHeader.vue'
import TimberItemStatus from '@/components/TimberItemStatus.vue'
import ChoiceAttributeField from '@/components/ChoiceAttributeField.vue'
import BooleanAttributeField from '@/components/BooleanAttributeField.vue'
import DateAttributeField from '@/components/DateAttributeField.vue'
import SaveBar from '@/components/SaveBar.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import FormattedTag from '@/components/FormattedTag.vue'

const props = defineProps<{
  // Plain tag number from the URL, e.g. "85". Passed in by the router (`props: true`).
  // Route params are always strings; the router guard has already validated the range.
  tagNumber: string
}>()

const router = useRouter()
const store = useTimberItemStore()
const toast = useToast()

const tagNumber = computed(() => Number(props.tagNumber))
const item = computed(() => store.findByTagNumber(tagNumber.value))

// Raw input per attribute id (see DraftInput). Only touched attributes have an entry.
const draft = ref<Record<string, DraftInput | undefined>>({})
// Series only: values already added with "Hinzufügen". Nothing sets this until the series field exists.
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
  const target = item.value ?? store.createTimberItem(tagNumber.value)
  for (const change of toSave) {
    store.recordAttribute(target.id, change.attributeId, change.value)
  }

  const hasSaved = isNew || toSave.length > 0
  toast.show(
    hasSaved
      ? { before: 'Stamm', tagNumber: tagNumber.value, after: 'gespeichert' }
      : { before: 'Keine Änderungen an Stamm', tagNumber: tagNumber.value },
  )

  draft.value = {}
  added.value = {}
  failedInputs.value = {}
  formKey.value++
}

// --- Leaving with unsaved changes ---------------------------------------
// The guard covers every way out: close button, browser/system back gesture.
const pendingLeave = ref<RouteLocationRaw | null>(null)
let isLeaveConfirmed = false

onBeforeRouteLeave((to) => {
  if (isLeaveConfirmed || !isDirty.value) {
    return true
  }
  pendingLeave.value = to.fullPath
  return false
})

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
      :pending-count="store.pendingCount"
      @close="onClose"
    />

    <TimberItemStatus :item="item" />

    <div :key="formKey" class="border-b border-line">
      <template v-for="attribute in store.attributes" :key="attribute.id">
        <ChoiceAttributeField
          v-if="attribute.type === 'choice'"
          :model-value="draftText(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          @update:model-value="draft[attribute.id] = $event"
        />
        <BooleanAttributeField
          v-else-if="attribute.type === 'boolean'"
          :model-value="draftFlag(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          @update:model-value="draft[attribute.id] = $event"
        />
        <DateAttributeField
          v-else-if="attribute.type === 'date'"
          :model-value="draftText(attribute.id)"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
          :error="shownErrors[attribute.id]"
          @update:model-value="draft[attribute.id] = $event"
        />
      </template>
    </div>

    <!-- Pushes the save bar down when the content is shorter than the screen. -->
    <div class="flex-auto"></div>

    <SaveBar :label="saveLabel" @save="onSave" />

    <ConfirmSheet
      v-if="pendingLeave"
      title="Änderungen verwerfen?"
      primary-label="Weiter bearbeiten"
      secondary-label="Verwerfen"
      @primary="onKeepEditing"
      @secondary="onDiscard"
    >
      <p>
        Deine Eingaben für Stamm <FormattedTag :tag-number="tagNumber" /> sind noch nicht
        gespeichert.
      </p>
    </ConfirmSheet>
  </div>
</template>
