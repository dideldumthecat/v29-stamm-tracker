<script lang="ts" setup>
import { computed } from 'vue'
import { RefreshCwIcon } from '@lucide/vue'
import { useTimberItemStore } from '@/stores/timberItems'

const props = withDefaults(
  defineProps<{
    pendingCount: number
    // Inverted variant for dark headers: icon only (plus counter), no "Sync" label.
    inverted?: boolean
  }>(),
  { inverted: false },
)

const store = useTimberItemStore()

const hasBadge = computed(() => props.pendingCount > 0)
// Inverted without pending entries shows nothing but the icon.
const isIconOnly = computed(() => props.inverted && !hasBadge.value)

/*
 * Padding rule, measured in the rendered button: px-2 puts the icon on the left and the text
 * or badge on the right the same distance (≈8px) from the inner edge. Lucide icons have no
 * visible margin worth compensating at this size, so both sides get the same padding.
 * Icon only: no padding, a fixed square with the icon centred by flexbox – exactly centred.
 */
const layoutClass = computed(() =>
  isIconOnly.value ? 'size-11 justify-center' : 'min-h-11 gap-2 px-2',
)
const colorClass = computed(() =>
  props.inverted ? 'border-paper bg-ink text-paper' : 'border-ink bg-paper text-ink',
)
</script>

<template>
  <RouterLink
    :to="{ name: 'sync' }"
    class="flex shrink-0 items-center rounded-full border-2 text-detail font-semibold"
    :class="[layoutClass, colorClass]"
    :aria-label="`${store.isSyncing ? 'Synchronisierung läuft' : 'Synchronisieren'}, ${pendingCount} offene Einträge`"
  >
    <RefreshCwIcon
      :size="inverted ? 18 : 20"
      :class="{ 'animate-spin motion-reduce:animate-none': store.isSyncing }"
      aria-hidden="true"
    />
    <!-- Only rendered when it has content: an empty flex item would still add a gap. -->
    <span v-if="!isIconOnly" class="flex items-center gap-1">
      <span v-if="!inverted">Sync</span>
      <span
        v-if="hasBadge"
        class="flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-1.5 text-sm tabular-nums"
        :class="inverted ? 'bg-paper text-ink' : 'bg-ink text-paper'"
        >{{ pendingCount }}</span
      >
    </span>
  </RouterLink>
</template>
