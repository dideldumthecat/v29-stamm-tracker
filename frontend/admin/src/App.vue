<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOutIcon } from '@lucide/vue'
import AuthorCredit from '@v29/shared/AuthorCredit.vue'

import { signOut, user } from '@/auth'

// One line per page, in the order of the design: Dashboard, Stämme, Balken, Merkmale, Nutzer, Aktivität.
const navigation = [{ label: 'Dashboard', to: { name: 'dashboard' } }]

const route = useRoute()
const router = useRouter()
const error = ref(false)

async function onSignOut() {
  error.value = false
  try {
    await signOut()
  } catch {
    error.value = true
    return
  }
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <!-- The global focus ring is ink: on the black header it would vanish -->
    <header
      v-if="user && route.name !== 'login'"
      class="bg-ink text-paper **:focus-visible:outline-paper"
    >
      <div class="page-column flex min-h-[72px] flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <div class="mr-auto">
          <div class="font-bold">V29 Stamm-Tracker</div>
          <div class="text-sm">{{ user.name }}</div>
        </div>
        <nav
          aria-label="Hauptnavigation"
          class="flex flex-wrap gap-1 max-lg:order-last max-lg:basis-full"
        >
          <RouterLink
            v-for="item in navigation"
            :key="item.label"
            :to="item.to"
            class="flex min-h-11 items-center rounded-lg px-3.5 font-bold aria-[current=page]:bg-paper aria-[current=page]:text-ink"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <p v-if="error" class="text-sm font-semibold" role="alert">Abmelden fehlgeschlagen.</p>
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-lg"
          aria-label="Abmelden"
          title="Abmelden"
          @click="onSignOut"
        >
          <LogOutIcon aria-hidden="true" />
        </button>
      </div>
    </header>
    <div class="flex-1">
      <RouterView />
    </div>
    <footer class="page-column py-8 text-center text-[13px] text-mute">
      <AuthorCredit />
    </footer>
  </div>
</template>
