<script setup lang="ts">
import { ChevronRightIcon } from '@lucide/vue'
import FormattedTag from './FormattedTag.vue'

// The inside of a beam row on the stem screen (app: saved ones are links, draft ones buttons; administration: links).
defineProps<{ tagNumber: string; summary: string; note?: string }>()
</script>

<template>
  <strong class="text-xl whitespace-nowrap tabular-nums"
    ><FormattedTag :tag-number="tagNumber"
  /></strong>
  <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-caption text-mute">
    <span>{{ summary }}</span>
    <span v-if="note">{{ note }}</span>
  </span>
  <ChevronRightIcon :size="22" aria-hidden="true" />
</template>
