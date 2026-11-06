<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatInviteInput, isInviteCode } from '@v29/shared/invite'

import { ApiError } from '@/api/client'
import { signIn } from '@/auth'

const route = useRoute()
const router = useRouter()

const code = ref('')
// Typed and pasted text alike: only letters and digits, capitals, a hyphen after every group of four.
watch(code, (text) => (code.value = formatInviteInput(text)))
const error = ref<string | null>(null)
const isBusy = ref(false)
const inputElement = useTemplateRef('inputElement')

function clear() {
  code.value = ''
  error.value = null
  inputElement.value?.focus()
}

// The server has the final word (it also maps look-alike characters); this only catches an unfinished code.
function messageFor(failure: unknown) {
  const status = failure instanceof ApiError ? failure.status : 0
  if (status === 401) return 'Code unbekannt oder gesperrt.'
  if (status === 403) return 'Dieser Code hat keinen Zugang zur Administration.'
  return 'Keine Verbindung zum Server.'
}

async function onSubmit() {
  if (!isInviteCode(code.value)) {
    error.value = 'Kein Einladungscode erkannt'
    return
  }
  error.value = null
  isBusy.value = true
  try {
    await signIn(code.value)
  } catch (failure) {
    error.value = messageFor(failure)
    return
  } finally {
    isBusy.value = false
  }
  // Only paths of this application, never another site.
  const redirect = route.query.redirect
  await router.push(typeof redirect === 'string' && /^\/(?!\/)/.test(redirect) ? redirect : '/')
}
</script>

<template>
  <main class="mx-auto flex max-w-sm flex-col gap-4 px-4 py-16">
    <h1 class="text-2xl font-bold">V29 Stamm-Tracker – Administration</h1>
    <form class="flex flex-col gap-3" @submit.prevent="onSubmit">
      <label for="invite-code" class="font-bold">Einladungscode</label>
      <div class="relative">
        <input
          id="invite-code"
          ref="inputElement"
          v-model="code"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          maxlength="14"
          enterkeyhint="go"
          spellcheck="false"
          placeholder="K7QM-4XHT-9RDP"
          class="h-14 w-full rounded-lg border-2 border-ink bg-paper px-12 text-center text-xl font-semibold"
        />
        <button
          v-if="code && !isBusy"
          type="button"
          class="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-2xl"
          aria-label="Code löschen"
          @click="clear"
        >
          ×
        </button>
      </div>
      <p v-if="error" class="text-sm font-semibold" role="alert">{{ error }}</p>
      <button
        type="submit"
        class="h-14 rounded-lg bg-ink text-lg font-bold text-paper disabled:bg-disabled"
        :disabled="isBusy"
      >
        {{ isBusy ? 'Anmelden …' : 'Anmelden' }}
      </button>
    </form>
  </main>
</template>
