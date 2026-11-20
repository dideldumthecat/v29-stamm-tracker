<script setup lang="ts">
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import StatusCard from '@/components/StatusCard.vue'
import { LOADING_TEXT } from '@/loadingText'

defineProps<{ textClass?: string }>()
</script>

<!-- The loading state of a whole page or result area: attributes (`role`, `class`) fall through to `StatusCard`. -->
<template>
  <StatusCard title="Moment" :text-class="textClass">
    <template #icon>
      <SawBladeIcon :size="96" :stroke-width="1.5" spinning class="text-ink" aria-hidden="true" />
    </template>
    <template #text>{{ LOADING_TEXT }}</template>
  </StatusCard>
</template>
