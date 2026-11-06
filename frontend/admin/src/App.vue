<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOutIcon } from '@lucide/vue'
import AuthorCredit from '@v29/shared/AuthorCredit.vue'
import V29Logo from '@v29/shared/V29Logo.vue'

import { signOut, user } from '@/auth'

// Only pages that exist, one line each, in the order of the design: Dashboard, Stämme, Balken, Merkmale, Nutzer, Aktivität.
const navigation = [{ label: 'Aktivität', to: { name: 'activity' } }]

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
        <div class="mr-auto flex items-center gap-3">
          <!-- 42 = heading line (24) + gap (2) + name line (16), as in the app header -->
          <V29Logo :height="42" />
          <div class="flex flex-col gap-0.5">
            <div class="text-[17px] leading-6 font-bold">
              <span class="sr-only">V29 </span>Stamm-Tracker
            </div>
            <!-- paper at 85 % on ink is about #dadada, contrast ≈ 14:1 -->
            <div class="text-xs text-paper/85">{{ user.name }}</div>
          </div>
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
