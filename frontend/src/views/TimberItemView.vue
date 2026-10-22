<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteLeave, useRouter, type RouteLocationRaw } from 'vue-router'
import { useTimberItemStore } from '@/stores/timberItems'
import { useToast } from '@/composables/useToast'
import TimberItemHeader from '@/components/TimberItemHeader.vue'
import TimberItemStatus from '@/components/TimberItemStatus.vue'
import ChoiceAttributeField from '@/components/ChoiceAttributeField.vue'
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

// Draft per attribute id. Only touched attributes have an entry.
const draft = ref<Record<string, string | undefined>>({})

// Incremented after saving to remount the fields: resets their local "unlocked" state.
const formKey = ref(0)

// Draft values that actually differ from what is recorded.
const changes = computed(() =>
  store.attributes.flatMap((attribute) => {
    const value = draft.value[attribute.id]
    const recorded = item.value?.values[attribute.id]?.optionId
    return value && value !== recorded ? [{ attributeId: attribute.id, optionId: value }] : []
  }),
)
const isDirty = computed(() => changes.value.length > 0)

const saveLabel = computed(() => (item.value ? 'Speichern' : 'Stamm anlegen & speichern'))

function onSave() {
  const isNew = !item.value
  // Like the click prototype: a new item is created even without values.
  const target = item.value ?? store.createTimberItem(tagNumber.value)
  for (const change of changes.value) {
    store.recordValue(target.id, change.attributeId, change.optionId)
  }

  const hasSaved = isNew || changes.value.length > 0
  toast.show(
    hasSaved
      ? { before: 'Stamm', tagNumber: tagNumber.value, after: 'gespeichert' }
      : { before: 'Keine Änderungen an Stamm', tagNumber: tagNumber.value },
  )

  draft.value = {}
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
          v-model="draft[attribute.id]"
          :attribute="attribute"
          :recorded="item?.values[attribute.id]"
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
