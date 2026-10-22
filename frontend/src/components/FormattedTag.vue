<script setup lang="ts">
import { computed } from 'vue'
import { formatTag } from '@/utils/tag'

const props = withDefaults(
  defineProps<{
    tagNumber: number
    // How strongly the leading zeros fade; the header uses a lighter fade on dark ground.
    zeroOpacity?: 40 | 50
  }>(),
  { zeroOpacity: 40 },
)

const parts = computed(() => {
  const formatted = formatTag(props.tagNumber)
  const significant = String(props.tagNumber)
  return { zeros: formatted.slice(0, formatted.length - significant.length), significant }
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
