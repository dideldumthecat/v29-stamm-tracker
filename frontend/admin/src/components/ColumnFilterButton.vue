<script setup lang="ts">
import { computed } from 'vue'

import FilterButton from '@/components/FilterButton.vue'
import FilterChecklist from '@/components/FilterChecklist.vue'
import FilterRange from '@/components/FilterRange.vue'
import FilterText from '@/components/FilterText.vue'
import {
  filterType,
  offersNone,
  pickOptions,
  type ColumnFilter,
  type FilterType,
} from '@/listFilters'
import type { Column, Row } from '@/stemlist'

/**
 * The filter button of one column of a list of stems or beams, with the content that fits the type of the column (`filterType`,
 * never its name). Holds no filter state: `filter` is what the URL says, every change goes up and comes back as `filter`.
 */
const props = defineProps<{ column: Column; filter: ColumnFilter | null; rows: Row[] }>()
const emit = defineEmits<{ change: [filter: ColumnFilter | null, replace: boolean] }>()
const open = defineModel<boolean>('open', { default: false })

const type = computed(() => filterType(props.column) as FilterType)
const textType = computed(() => (type.value === 'photo' ? 'photo' : 'text'))
const picks = computed(() => (props.filter?.kind === 'pick' ? props.filter.picks : []))
const checklist = computed(
  () => type.value === 'choice' || type.value === 'boolean' || type.value === 'month',
)
// All rows of the list, not the filtered ones: an option does not vanish because of another filter
const options = computed(() =>
  checklist.value ? pickOptions(props.column, props.rows, picks.value) : [],
)
const setPicks = (next: string[]) =>
  emit('change', next.length ? { kind: 'pick', picks: next } : null, false)
</script>

<template>
  <FilterButton
    :id="column.id"
    v-model:open="open"
    :name="column.label"
    :active="!!filter"
    :count="filter?.kind === 'pick' ? filter.picks.length : undefined"
  >
    <FilterChecklist
      v-if="checklist"
      :options="options"
      :picks="picks"
      @change="setPicks"
    />
    <FilterRange
      v-else-if="type === 'number' || type === 'date' || type === 'count'"
      :type="type"
      :filter="filter"
      :unit="column.attribute?.unit ?? undefined"
      :allow-none="offersNone(column)"
      @change="(next, replace) => emit('change', next, replace)"
    />
    <FilterText
      v-else
      :type="textType"
      :filter="filter"
      @change="(next, replace) => emit('change', next, replace)"
    />
  </FilterButton>
</template>
