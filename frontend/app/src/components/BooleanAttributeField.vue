<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckIcon, PencilIcon } from '@lucide/vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import InactiveHint from '@/components/InactiveHint.vue'
import { formatDateTime } from '@/utils/date'
import { useTimberItemStore } from '@/stores/timberItems'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  // No pencil and no input: inactive attribute, or a stem split into beams.
  readonly?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
}>()

const store = useTimberItemStore()

// A boolean attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])

// Draft state. undefined = untouched; the parent compares it with `recorded`.
const draft = defineModel<boolean | undefined>()

// A recorded value is locked against accidental changes; the pencil unlocks it.
const isUnlocked = ref(false)
const isLocked = computed(
  () => current.value !== undefined && (props.readonly || !isUnlocked.value),
)

// What the button shows: the draft if touched, otherwise the recorded value. Nothing recorded = unticked.
const isChecked = computed(() => draft.value ?? current.value?.value === true)

function toggle() {
  draft.value = !isChecked.value
}
</script>

<template>
  <section
    v-if="isLocked"
    class="flex flex-col gap-2.5 border-t border-line bg-locked py-section px-gutter text-mute *:max-w-full *:min-w-0"
  >
    <div
      class="flex min-h-[60px] items-center gap-3 rounded-lg border-2 border-lockline pl-3.5 text-[17px] font-bold"
    >
      <!-- Ticked: filled box. Unticked: empty box and "Nein", so "No" is not mistaken for "not recorded". -->
      <span
        v-if="current?.value"
        class="flex size-[30px] items-center justify-center rounded-md bg-dim text-paper"
      >
        <CheckIcon :size="20" :stroke-width="3" aria-hidden="true" />
      </span>
      <span v-else class="size-[30px] rounded-md border-2 border-lockline"></span>
      <span class="min-w-0 flex-1">
        <span :class="{ 'line-through': !attribute.active }">{{ attribute.name }}</span
        >{{ current?.value ? '' : ': Nein' }} <InactiveHint v-if="!attribute.active" class="block"
      /></span>
      <button
        v-if="!readonly"
        type="button"
        class="mr-0.5 flex size-11 items-center justify-center rounded-md text-ink"
        :aria-label="`${attribute.name} ändern`"
        @click="isUnlocked = true"
      >
        <PencilIcon :size="22" aria-hidden="true" />
      </button>
    </div>
    <p v-if="attribute.description" class="text-sm leading-[1.4] text-body">
      {{ attribute.description }}
    </p>
    <span v-if="current" class="text-[13px] text-mute"
      >{{ formatDateTime(current.recorded_at) }} · {{ store.userName(current.user_id)
      }}{{ inherited ? ' · vom Stamm' : '' }}</span
    >
  </section>

  <section
    v-else
    class="flex flex-col gap-2.5 border-t border-line py-section px-gutter *:max-w-full *:min-w-0"
  >
    <button
      type="button"
      class="group flex min-h-[60px] w-full items-center gap-3.5 rounded-lg border-2 border-ink bg-paper px-3.5 text-left text-[17px] font-bold active:bg-ink active:text-paper active:opacity-100"
      :aria-pressed="isChecked"
      @click="toggle"
    >
      <span
        class="flex size-[30px] items-center justify-center rounded-md border-2 border-ink bg-paper group-aria-pressed:bg-ink group-aria-pressed:text-paper"
      >
        <CheckIcon v-if="isChecked" :size="20" :stroke-width="3" aria-hidden="true" />
      </span>
      <span class="flex-1">{{ attribute.name }}</span>
    </button>
    <p v-if="attribute.description" class="text-sm leading-[1.4] text-body">
      {{ attribute.description }}
    </p>
  </section>
</template>
