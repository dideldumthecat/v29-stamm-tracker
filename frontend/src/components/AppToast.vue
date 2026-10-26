<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { CircleCheckIcon, RefreshCwIcon, TriangleAlertIcon, XIcon } from '@lucide/vue'
import FormattedTag from '@/components/FormattedTag.vue'
import { useToast } from '@/composables/useToast'

const { current } = useToast()
// registerType 'prompt': the new service worker waits until the user confirms.
const { needRefresh, updateServiceWorker } = useRegisterSW()
const route = useRoute()

// Start screen only: updating reloads the app, which would throw away an unsaved entry.
// A regular toast takes precedence; the update hint returns once it is gone.
const showUpdate = computed(() => needRefresh.value && route.name === 'start' && !current.value)
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
      <!-- Durations match TOAST_ENTER_MS in useToast. No key: a new message swaps the text in place.
           out-in: switching between toast and update hint would otherwise stack both bands mid-transition. -->
      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        leave-active-class="transition duration-150 ease-in"
        enter-from-class="-translate-y-full motion-reduce:translate-y-0 motion-reduce:opacity-0"
        leave-to-class="-translate-y-full motion-reduce:translate-y-0 motion-reduce:opacity-0"
      >
        <div
          v-if="current"
          class="flex items-center gap-3 border-b border-line py-3.5 px-gutter text-[17px] leading-[1.3] font-normal text-ink shadow-sm select-none"
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
          <span class="min-w-0 flex-1"
            >{{ current.before }}
            <FormattedTag v-if="current.tagNumber !== undefined" :tag-number="current.tagNumber" />
            {{ current.after }}</span
          >
        </div>
        <div
          v-else-if="showUpdate"
          class="pointer-events-auto flex items-center gap-3 border-b border-line bg-paper py-1 px-gutter text-[17px] leading-[1.3] font-normal text-ink shadow-sm select-none"
          role="status"
        >
          <RefreshCwIcon class="shrink-0 text-mute" :size="20" aria-hidden="true" />
          <span class="min-w-0 flex-1">Neue Version verfügbar</span>
          <button
            type="button"
            class="min-h-11 shrink-0 px-1.5 font-normal text-ink underline"
            @click="updateServiceWorker(true)"
          >
            Aktualisieren
          </button>
          <button
            type="button"
            class="-mr-3 flex size-11 shrink-0 items-center justify-center text-ink"
            aria-label="Hinweis schließen"
            @click="needRefresh = false"
          >
            <XIcon :size="20" aria-hidden="true" />
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
