<script setup lang="ts">
import { useId } from 'vue'

/**
 * A checkbox with its text, at least 40 px high. Built as a block with the box positioned (absolute) beside the text, not as a flex row:
 * a flex container takes the baseline of one of its items, in this case the box, whose baseline is its bottom edge, so the label of a
 * settings row (SettingsRow) would stand on the bottom of the box and not on the line of the text. In a block the first baseline is the
 * text's. `labelledby` (ids of other elements, e.g. the label of the settings row) goes in front of the text in the accessible name ("Wert vererbbar Ja"). The text has a line of 24 px (leading-6) between 8 px of padding; the box is centered on that first line (10 px from the top).
 */
defineProps<{ checked: boolean; disabled?: boolean; labelledby?: string }>()
const textId = useId()
defineEmits<{ change: [checked: boolean] }>()
</script>

<template>
  <label class="relative block py-2 pl-8 leading-6" :class="disabled && 'text-mute'">
    <input
      type="checkbox"
      class="absolute top-2.5 left-0 size-5 accent-ink"
      :checked="checked"
      :disabled="disabled"
      :aria-labelledby="labelledby ? `${labelledby} ${textId}` : undefined"
      @change="$emit('change', ($event.target as HTMLInputElement).checked)"
    />
    <span :id="textId"><slot /></span>
  </label>
</template>
