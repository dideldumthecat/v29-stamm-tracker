<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOutIcon } from '@lucide/vue'
import AuthorCredit from '@v29/shared/AuthorCredit.vue'
import V29Logo from '@v29/shared/V29Logo.vue'

import { connectionLost, signOut, user } from '@/auth'
import AdminMenu from '@/components/AdminMenu.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import { useSizeVariable } from '@/sizeVariable'

// Only pages that exist, one line each, in the order of the design: Dashboard, Stämme, Balken, Merkmale, Nutzer, Aktivität.
const navigation = [
  { label: 'Dashboard', to: { name: 'dashboard' } },
  { label: 'Stämme', to: { name: 'stems' } },
  { label: 'Balken', to: { name: 'beams' } },
  { label: 'Aktivität', to: { name: 'activity' } },
]

const route = useRoute()
const router = useRouter()
const error = ref(false)

// From `lg` on the header is sticky and may wrap (error message), so its real height feeds `scroll-padding-top` (main.css):
// focused elements and anchors then never land under it. Below `lg` it scrolls away and the variable is ignored.
const header = useTemplateRef<HTMLElement>('header')
useSizeVariable(header, '--header-height', 'height')
// The footer height is for pages that must leave room for it at the end (the photo card of the detail view)
const footer = useTemplateRef<HTMLElement>('footer')
useSizeVariable(footer, '--footer-height', 'height')

const retry = () => router.replace(connectionLost.value ?? '/')

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
  <!-- A page that scrolls sideways (marked data-wide, the stem list) makes the page as wide as its content. Header and footer stay as wide as the
       window (100cqw, main.css) and stick to its left edge, so they stay put meanwhile. -->
  <div class="flex min-h-dvh flex-col has-data-wide:w-max">
    <!-- The global focus ring is ink: on the black header it would vanish -->
    <header
      v-if="user && route.name !== 'login'"
      ref="header"
      class="sticky left-0 z-50 w-[100cqw] bg-ink text-paper **:focus-visible:outline-paper lg:top-0"
    >
      <div class="page-column flex min-h-[72px] flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <!-- Logo, title and name lead to the dashboard; the name of the link says where it goes, starting with the visible title -->
        <RouterLink
          :to="{ name: 'dashboard' }"
          aria-label="V29 Stamm-Tracker – Dashboard"
          class="mr-auto flex items-center gap-3 rounded-lg"
        >
          <!-- 42 = heading line (24) + gap (2) + name line (16), as in the app header -->
          <V29Logo :height="42" />
          <div class="flex flex-col gap-0.5">
            <div class="text-label leading-6 font-bold">
              <span class="sr-only">V29 </span>Stamm-Tracker
            </div>
            <!-- paper at 85 % on ink is about #dadada, contrast ≈ 14:1 -->
            <div class="text-xs text-paper/85">{{ user.name }}</div>
          </div>
        </RouterLink>
        <nav
          aria-label="Hauptnavigation"
          class="flex flex-wrap gap-1 max-lg:order-last max-lg:basis-full"
        >
          <RouterLink
            v-for="item in navigation"
            :key="item.label"
            :to="item.to"
            class="flex min-h-11 items-center rounded-lg px-3.5 aria-[current=page]:bg-paper aria-[current=page]:text-ink"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <p v-if="error" class="text-sm font-semibold" role="alert">Abmelden fehlgeschlagen.</p>
        <!-- Gear and "Abmelden" side by side, 44 px each; the pair is pulled out by the padding of the buttons so that the icons end at the column edge -->
        <div class="-mr-2.5 flex">
          <AdminMenu />
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
      </div>
    </header>
    <div class="flex-1">
      <!-- The first check of the sign-in found no server: this stands in for the page until the retry gets through -->
      <LoadFailure v-if="connectionLost" :failure="0" @retry="retry" />
      <!-- The name as key: the two lists are one component, each starts fresh (own filters, own data) -->
      <RouterView v-else :key="String(route.name)" />
    </div>
    <footer ref="footer" class="sticky left-0 w-[100cqw]">
      <div class="page-column py-8 text-center text-caption text-mute">
        <AuthorCredit />
      </div>
    </footer>
  </div>
</template>
