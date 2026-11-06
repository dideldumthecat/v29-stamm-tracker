<script setup lang="ts">
import { CircleCheckIcon, TriangleAlertIcon } from '@lucide/vue'
import FormattedTag from '@/components/FormattedTag.vue'
import { useToast } from '@/composables/useToast'

const { current } = useToast()
</script>

<template>
  <!-- Not clickable (pointer-events-none): taps go through to the content below.
       The wrapper starts at the header's lower edge and clips, so the toast slides out from under
       the header without being drawn over it. Same width as the header: the app frame including its
       transparent stand-in for the frame's side borders. Bottom padding keeps the shadow from being clipped. -->
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-[calc(var(--spacing-header)+env(safe-area-inset-top,0px))] z-60 mx-auto max-w-[430px] overflow-hidden pb-4 min-[480px]:border-x min-[480px]:border-transparent"
    >
      <!-- Durations match TOAST_ENTER_MS in useToast. No key: a new message swaps the text in place. -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        leave-active-class="transition duration-150 ease-in"
        enter-from-class="-translate-y-full motion-reduce:translate-y-0 motion-reduce:opacity-0"
        leave-to-class="-translate-y-full motion-reduce:translate-y-0 motion-reduce:opacity-0"
      >
        <div
          v-if="current"
          class="flex items-center justify-center gap-3 border-b border-line py-3.5 px-gutter text-center text-[17px] leading-[1.3] font-normal text-ink shadow-sm select-none"
          :class="current.kind === 'warning' ? 'bg-well' : 'bg-paper'"
          role="status"
        >
          <TriangleAlertIcon
            v-if="current.kind === 'warning'"
            class="shrink-0 text-ink"
            :size="20"
            aria-hidden="true"
          />
          <CircleCheckIcon v-else class="shrink-0 text-mute" :size="20" aria-hidden="true" />
          <span class="min-w-0"
            >{{ current.before }}
            <FormattedTag v-if="current.tagNumber !== undefined" :tag-number="current.tagNumber" />
            {{ current.after }}</span
          >
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
