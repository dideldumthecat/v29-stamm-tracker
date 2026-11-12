<script setup lang="ts">
import { SignpostIcon, WormIcon } from '@lucide/vue'
import StatusCard from '@/components/StatusCard.vue'

// 0 = the request never reached the server; every other status is a server error.
defineProps<{ failure: number }>()
defineEmits<{ retry: [] }>()
</script>

<!-- The error state of all three pages, so texts and icons live in one place. Replaces the result area like "Moment". -->
<template>
  <StatusCard
    :title="failure === 0 ? 'Auf dem Holzweg' : 'Hier ist grad der Wurm drin'"
    role="alert"
  >
    <template #icon>
      <SignpostIcon
        v-if="failure === 0"
        :size="96"
        :stroke-width="1.5"
        class="text-ink"
        aria-hidden="true"
      />
      <WormIcon v-else :size="96" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
    </template>
    <template #text>
      {{
        failure === 0
          ? 'Wir konnten leider keine Verbindung zum Server finden.'
          : 'Auf dem Server ist etwas schiefgelaufen.'
      }}
    </template>
    <button
      type="button"
      class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
      @click="$emit('retry')"
    >
      Erneut versuchen
    </button>
  </StatusCard>
</template>
