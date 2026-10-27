<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import NumPad from '@/components/NumPad.vue'
import TagNumberDisplay from '@/components/TagNumberDisplay.vue'
import OpenButton from '@/components/OpenButton.vue'
import TimberItemHeader from '@/components/TimberItemHeader.vue'
import ConfirmSheet from '@/components/ConfirmSheet.vue'
import FormattedTag from '@/components/FormattedTag.vue'
import { useTagInput } from '@/composables/useTagInput'
import { useToast } from '@/composables/useToast'
import { useTimberItemStore } from '@/stores/timberItems'

const props = defineProps<{
  // Current tag of the item, e.g. "85" or "85-A"; the router guard has checked that it exists and is not split.
  tagNumber: string
}>()

const router = useRouter()
const store = useTimberItemStore()
const toast = useToast()
const {
  tagInput,
  tagNumber: newTag,
  isValidTagNumber,
  isTagNumberTooHigh,
  onDigit,
  onClear,
  onDelete,
} = useTagInput()

// Captured once: after the change the item no longer answers to the old tag.
const item = store.findByTag(props.tagNumber)!
const kind = item.parent_id ? 'Balken' : 'Stamm'

const holder = computed(() =>
  isValidTagNumber.value ? store.tagHolder(newTag.value, item.id) : undefined,
)
const holderParent = computed(() =>
  store.items.find((candidate) => candidate.id === holder.value?.parent_id),
)
const isUnchanged = computed(() => String(newTag.value) === props.tagNumber)
const isConfirming = ref(false)

// Replace, not push: back from the item must not land on the old tag, which may now be free.
function onClose() {
  router.replace({ name: 'timber-item', params: { tagNumber: props.tagNumber } })
}

function onConfirm() {
  store.assignTag(item.id, newTag.value)
  toast.show({ before: 'Plakette', tagNumber: newTag.value, after: 'gespeichert' })
  router.replace({ name: 'timber-item', params: { tagNumber: String(newTag.value) } })
}
</script>

<template>
  <div class="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
    <TimberItemHeader
      :tag-number="props.tagNumber"
      :kind="kind.toUpperCase()"
      :pending-count="store.pendingCount"
      @close="onClose"
    />
    <h2 class="pt-3 px-gutter text-center text-[17px] font-bold">Neue Plakette eingeben</h2>

    <div class="flex min-h-0 flex-col justify-end overflow-hidden pb-3">
      <TagNumberDisplay :tag-input="tagInput" :has-error="isTagNumberTooHigh" />
      <p v-if="holder" class="-mt-3 mb-3 px-gutter text-center text-sm" role="alert">
        Plakette <FormattedTag :tag-number="newTag" /> ist schon vergeben<template
          v-if="holderParent?.tag_number"
          >: Balken aus Stamm <FormattedTag :tag-number="holderParent.tag_number" /></template
        >.
      </p>
      <OpenButton
        label="Plakette ändern"
        :is-disabled="!isValidTagNumber || !!holder || isUnchanged"
        @open="isConfirming = true"
      />
      <NumPad @digit="onDigit" @clear="onClear" @delete="onDelete" />
    </div>

    <ConfirmSheet
      v-if="isConfirming"
      primary-label="Abbrechen"
      secondary-label="Plakette ändern"
      emphasize-secondary
      @primary="isConfirming = false"
      @secondary="onConfirm"
    >
      <template #title>
        Plakette ändern: <FormattedTag :tag-number="props.tagNumber" /> →
        <FormattedTag :tag-number="newTag" />?
      </template>
      <p>
        {{ kind }} <FormattedTag :tag-number="props.tagNumber" /> ist danach nur noch unter
        <FormattedTag :tag-number="newTag" /> zu finden.
      </p>
    </ConfirmSheet>
  </div>
</template>
