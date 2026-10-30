<script setup lang="ts">
import type { SyncResult } from '@/stores/timberItems'
import FormattedTag from '@/components/FormattedTag.vue'

defineProps<{ rejected: SyncResult['rejected'] }>()
</script>

<template>
  <div
    v-for="({ tagNumber, isBeam, keptTag }, index) in rejected"
    :key="index"
    class="max-w-[40ch] rounded-lg border-2 border-ink px-3.5 py-3 text-left text-sm leading-[1.4]"
    role="alert"
  >
    <template v-if="keptTag !== undefined">
      Plakette
      <strong class="tabular-nums"><FormattedTag :tag-number="tagNumber" /></strong> ist schon
      vergeben. {{ isBeam ? 'Balken' : 'Stamm' }}
      <template v-if="keptTag"><FormattedTag :tag-number="keptTag" /></template> behält seine
      bisherige Plakette.
    </template>
    <template v-else>
      {{ isBeam ? 'Balken' : 'Stamm' }}
      <strong class="tabular-nums"><FormattedTag :tag-number="tagNumber" /></strong> war bereits
      erfasst. Deine Angaben dazu wurden nicht übernommen. Bitte prüfe die Nummer und erfasse
      fehlende Werte am bestehenden {{ isBeam ? 'Balken' : 'Stamm' }}.
    </template>
  </div>
</template>
