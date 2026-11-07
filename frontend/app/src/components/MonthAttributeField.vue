<script setup lang="ts">
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import DateAttributeField from '@/components/DateAttributeField.vue'

/** Month and year only (e.g. Fälldatum): the date field with a month picker. */
const props = defineProps<{
  attribute: Attribute
  recorded: AttributeValueRecord[] | undefined
  readonly?: boolean
  inherited?: boolean
  // Set by the parent after a failed save: browsers without a month picker show a plain text field.
  error?: string
  // Resolved by the caller, so the field needs no store.
  userName: (userId: string) => string
}>()

// Draft = "YYYY-MM" ("" while cleared or incomplete). undefined = untouched.
const draft = defineModel<string | undefined>()
</script>

<template>
  <DateAttributeField v-bind="props" v-model="draft" type="month" />
</template>
