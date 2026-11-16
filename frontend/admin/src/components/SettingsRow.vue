<script setup lang="ts">
import { useId } from 'vue'

/**
 * A row of the settings, built like the rows of the card "Merkmale" in the detail view: from 640 px 2fr | 3fr with 16 px between (below it
 * the label stands above the field, which has the full width), 12 px above and below
 * (the lines between the rows come from the form, none above the first), the label at the left in 13 px semibold `mute`, the field at the
 * right, the error of the field under it. The label stands on the baseline of the first text line at the right (`items-baseline`: that of
 * the text in an input, a select or a checkbox row, of a help text), see CheckboxRow for the checkboxes. `labelFor` ties the label to a field; without it the row is a group (checkboxes) named by its label.
 */
const props = defineProps<{ label: string; labelFor?: string; error?: string }>()
const labelId = useId()
defineSlots<{ default(): unknown; hint?(): unknown }>()
</script>

<template>
  <div
    class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
    :role="props.labelFor ? undefined : 'group'"
    :aria-labelledby="props.labelFor ? undefined : labelId"
    :data-error="error ? '' : undefined"
  >
    <component
      :is="props.labelFor ? 'label' : 'div'"
      :id="labelId"
      :for="props.labelFor"
      class="text-caption font-semibold wrap-anywhere text-mute"
      >{{ label }}</component
    >
    <div class="flex min-w-0 flex-col gap-1.5">
      <slot />
      <p v-if="error" class="text-sm font-semibold" role="alert">{{ error }}</p>
      <slot name="hint" />
    </div>
  </div>
</template>
