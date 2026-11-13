<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'

import FilterField from '@/components/FilterField.vue'
import type { ColumnFilter } from '@/listFilters'

/**
 * The filter of a text ("enthält …", present, not recorded) or of photos (with, without): alternatives, one at a time.
 * Holds no filter state: `filter` is what the page says, every change goes up (`change`) and comes back as `filter`.
 */
const props = defineProps<{ type: 'text' | 'photo'; filter: ColumnFilter | null }>()
const emit = defineEmits<{ change: [filter: ColumnFilter | null, replace: boolean] }>()

const name = useId()
const field = useTemplateRef<InstanceType<typeof FilterField>>('field')

// "Enthält" chosen without a text yet: the URL cannot hold it, so the pop-up remembers it.
const picked = ref(false)
const mode = computed(() => {
  const kind = props.filter?.kind
  if (kind === 'none' || kind === 'has') return kind
  return kind === 'contains' || picked.value ? 'contains' : ''
})
async function choose(next: 'contains' | 'has' | 'none') {
  picked.value = next === 'contains'
  if (next === 'contains') {
    // The old filter is gone, the field takes the next one
    if (props.filter) emit('change', null, false)
    await nextTick()
    field.value?.focus()
  } else emit('change', { kind: next }, false)
}
const containsText = computed(() => (props.filter?.kind === 'contains' ? props.filter.text : ''))
function setContains(text: string, replace: boolean) {
  picked.value = true
  emit('change', text ? { kind: 'contains', text } : null, replace)
}
const row = 'flex h-10 items-center gap-3 rounded-md px-2 hover:bg-well'
</script>

<template>
  <div>
    <template v-if="type === 'text'">
      <label :class="row">
        <input
          type="radio"
          :name="name"
          class="size-5 shrink-0 accent-ink"
          :checked="mode === 'contains'"
          @change="choose('contains')"
        />
        Enthält
      </label>
      <div class="px-2 pb-2 pl-10">
        <FilterField
          ref="field"
          aria-label="Suchtext"
          :current="containsText"
          :readable="() => true"
          @apply="setContains"
        />
      </div>
    </template>
    <label :class="row">
      <input
        type="radio"
        :name="name"
        class="size-5 shrink-0 accent-ink"
        :checked="mode === 'has'"
        @change="choose('has')"
      />
      {{ type === 'photo' ? 'Mit Fotos' : 'Vorhanden' }}
    </label>
    <label :class="row">
      <input
        type="radio"
        :name="name"
        class="size-5 shrink-0 accent-ink"
        :checked="mode === 'none'"
        @change="choose('none')"
      />
      {{ type === 'photo' ? 'Ohne Fotos' : 'Nicht erfasst' }}
    </label>
  </div>
</template>
