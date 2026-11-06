<script setup lang="ts">
import { computed } from 'vue'
import { formatTag } from './tag'

const props = withDefaults(
  defineProps<{
    // Plain number or a beam tag ("789-A": the number part is padded, the suffix kept).
    tagNumber: number | string
    // How strongly the leading zeros fade; the header uses a lighter fade on dark ground.
    zeroOpacity?: 40 | 50
  }>(),
  { zeroOpacity: 40 },
)

const parts = computed(() => {
  const number = parseInt(String(props.tagNumber))
  const formatted = formatTag(number)
  return {
    zeros: formatted.slice(0, formatted.length - String(number).length),
    significant: String(props.tagNumber),
  }
})
</script>

<template>
  <!-- Full class names in the template, so Tailwind finds them (no string concatenation). -->
  <span
    ><span v-if="parts.zeros" :class="zeroOpacity === 50 ? 'opacity-50' : 'opacity-40'">{{
      parts.zeros
    }}</span
    >{{ parts.significant }}</span
  >
</template>
