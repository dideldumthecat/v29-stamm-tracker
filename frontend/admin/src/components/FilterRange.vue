<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'

import FilterField from '@/components/FilterField.vue'
import { boundText, readBound, type ColumnFilter, type FilterType } from '@/listFilters'

/**
 * From–to for a number, a date or a count (both ends included, one may stay empty); with `allowNone` also "Nicht erfasst"
 * as the alternative. The inputs act like the field "Kennung": a complete input after a pause of 500 ms, Enter and leaving at once.
 * Holds no filter state: `filter` is what the page says, every change goes up (`change`) and comes back as `filter`.
 */
const props = defineProps<{
  type: 'number' | 'date' | 'count'
  filter: ColumnFilter | null
  unit?: string
  allowNone?: boolean
}>()
const emit = defineEmits<{ change: [filter: ColumnFilter | null, replace: boolean] }>()

const name = useId()
const first = useTemplateRef<InstanceType<typeof FilterField>>('first')
const type = computed<FilterType>(() => props.type)
// With "Nicht erfasst" or none of them chosen yet the range is a choice of its own; a count has no alternative
const choosable = computed(() => props.allowNone && props.type !== 'count')

// "Bereich" chosen without a value yet: the URL cannot hold it, so the pop-up remembers it.
const picked = ref(false)
const mode = computed(() =>
  props.filter?.kind === 'none' ? 'none' : props.filter || picked.value ? 'range' : '',
)
async function choose(next: 'range' | 'none') {
  picked.value = next === 'range'
  if (next === 'none') emit('change', { kind: 'none' }, false)
  // Leaving "Nicht erfasst" for the range: the old filter is gone, the field takes the next one
  else if (props.filter?.kind === 'none') emit('change', null, false)
  await nextTick()
  first.value?.focus()
}

const bound = (side: 'from' | 'to') => {
  const value = props.filter?.kind === 'range' ? props.filter[side] : ''
  // The date field is native and wants the day as in the URL
  return value && props.type !== 'date' ? boundText(props.type, value) : value
}
const readableBound = (text: string) => readBound(type.value, text) !== null
function setBound(side: 'from' | 'to', text: string, replace: boolean) {
  const range = props.filter?.kind === 'range' ? props.filter : { from: '', to: '' }
  const next = { from: range.from, to: range.to, [side]: text ? readBound(type.value, text)! : '' }
  picked.value = true
  emit('change', next.from || next.to ? { kind: 'range', ...next } : null, replace)
}
const input = computed(
  () =>
    ({
      number: { inputmode: 'decimal' },
      count: { inputmode: 'numeric' },
      date: { type: 'date' },
    })[props.type],
)
// A date field needs about 10 rem: the two fields stack in the narrow pop-up instead of being cut off
const dateWidth = computed(() => props.type === 'date' && 'min-w-40')
const row = 'flex h-10 items-center gap-3 rounded-md px-2 hover:bg-well'
</script>

<template>
  <div>
    <label v-if="choosable" :class="row">
      <input
        type="radio"
        :name="name"
        class="size-5 shrink-0 accent-ink"
        :checked="mode === 'range'"
        @change="choose('range')"
      />
      {{ type === 'date' ? 'Zeitraum' : 'Bereich' }}
    </label>
    <div class="flex flex-wrap items-end gap-x-3 gap-y-2 px-2 pb-2" :class="choosable && 'pl-10'">
      <label class="flex min-w-0 flex-1 flex-col text-sm text-mute" :class="dateWidth">
        Von
        <FilterField
          ref="first"
          v-bind="input"
          :current="bound('from')"
          :readable="readableBound"
          @apply="(text, replace) => setBound('from', text, replace)"
        />
      </label>
      <label class="flex min-w-0 flex-1 flex-col text-sm text-mute" :class="dateWidth">
        Bis
        <FilterField
          v-bind="input"
          :current="bound('to')"
          :readable="readableBound"
          @apply="(text, replace) => setBound('to', text, replace)"
        />
      </label>
      <span v-if="unit" class="pb-2.5 text-base text-ink">{{ unit }}</span>
    </div>
    <label v-if="choosable" :class="row">
      <input
        type="radio"
        :name="name"
        class="size-5 shrink-0 accent-ink"
        :checked="mode === 'none'"
        @change="choose('none')"
      />
      Nicht erfasst
    </label>
  </div>
</template>
