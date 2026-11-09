<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue'
import { RouterLink, useRouter } from 'vue-router'

const router = useRouter()

// "Zurück" steps back only if the page was opened from inside the administration (and not from the sign-in);
// otherwise, e.g. after a pasted link, it leads to the activity.
const previous = router.options.history.state.back
const canGoBack = typeof previous === 'string' && !previous.startsWith('/login')
</script>

<template>
  <!-- Looks like the "Aus Stamm" link of a beam; the callers only place it. -->
  <component
    :is="canGoBack ? 'button' : RouterLink"
    v-bind="canGoBack ? { type: 'button', onClick: () => router.back() } : { to: '/aktivitaet' }"
    class="flex h-11 items-center gap-2 font-semibold"
  >
    <ArrowLeftIcon :size="20" aria-hidden="true" />
    <span>Zurück</span>
  </component>
</template>
