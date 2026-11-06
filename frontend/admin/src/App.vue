<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { signOut, user } from '@/auth'

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
  <header
    v-if="user && route.name !== 'login'"
    class="flex items-center justify-end gap-4 border-b border-line px-4 py-2"
  >
    <p v-if="error" class="text-sm font-semibold" role="alert">Abmelden fehlgeschlagen.</p>
    <span>{{ user.name }}</span>
    <button
      type="button"
      class="h-11 rounded-md border-2 border-ink px-4 font-bold"
      @click="onSignOut"
    >
      Abmelden
    </button>
  </header>
  <RouterView />
</template>
