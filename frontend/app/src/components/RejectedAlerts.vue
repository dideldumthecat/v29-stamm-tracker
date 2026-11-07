<script setup lang="ts">
import type { SyncResult } from '@/stores/timberItems'
import FormattedTag from '@v29/shared/FormattedTag.vue'

defineProps<{ rejected: SyncResult['rejected'] }>()
</script>

<template>
  <div
    v-for="({ tagNumber, isBeam }, index) in rejected"
    :key="index"
    class="max-w-[40ch] rounded-lg border-2 border-ink px-3.5 py-3 text-left text-sm leading-copy"
    role="alert"
  >
    {{ isBeam ? 'Balken' : 'Stamm' }}
    <strong class="tabular-nums"><FormattedTag :tag-number="tagNumber" /></strong> war bereits
    erfasst. Deine Angaben dazu wurden nicht übernommen. Bitte prüfe die Nummer und erfasse fehlende
    Werte am bestehenden {{ isBeam ? 'Balken' : 'Stamm' }}.
  </div>
</template>
