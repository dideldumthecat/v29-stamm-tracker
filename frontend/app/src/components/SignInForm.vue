<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { XIcon } from '@lucide/vue'
import { ApiError } from '@/api/client'
import { useTimberItemStore } from '@/stores/timberItems'
import { formatInviteInput, isInviteCode } from '@v29/shared/invite'

const emit = defineEmits<{ 'signed-in': [] }>()

const store = useTimberItemStore()

const input = ref('')
watch(input, (text) => (input.value = formatInviteInput(text)))
const error = ref<string | null>(null)
const isBusy = ref(false)
const inputElement = useTemplateRef('inputElement')

function clear() {
  input.value = ''
  error.value = null
  // Focus synchronously inside the tap, otherwise iOS does not open the keyboard.
  inputElement.value?.focus()
}

async function onSubmit() {
  const code = input.value
  if (!isInviteCode(code)) {
    error.value = 'Kein Einladungscode erkannt'
    return
  }
  error.value = null
  isBusy.value = true
  try {
    await store.redeemInvite(code)
  } catch (failure) {
    error.value =
      failure instanceof ApiError && failure.status === 401
        ? 'Einladung ungültig oder widerrufen – bitte bei V29 nachfragen.'
        : 'Keine Verbindung zum Server. Versuch es erneut, sobald du Empfang hast.'
    return
  } finally {
    isBusy.value = false
  }
  emit('signed-in')
}
</script>

<template>
  <form class="flex w-full flex-col gap-3 text-center" @submit.prevent="onSubmit">
    <label for="invite-code" class="font-bold">Einladungscode</label>
    <div class="relative">
      <input
        id="invite-code"
        ref="inputElement"
        v-model="input"
        type="text"
        autocapitalize="characters"
        autocomplete="off"
        maxlength="14"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="go"
        placeholder="K7QM-4XHT-9RDP"
        class="h-16 w-full rounded-lg border-2 border-ink bg-paper px-12 text-center text-xl font-semibold tracking-wide"
      />
      <button
        v-if="input && !isBusy"
        type="button"
        class="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-ink"
        aria-label="Code löschen"
        @click="clear"
      >
        <XIcon :size="22" aria-hidden="true" />
      </button>
    </div>
    <p v-if="error" class="text-sm leading-copy font-semibold" role="alert">{{ error }}</p>
    <button
      type="submit"
      class="flex h-action w-full items-center justify-center rounded-lg bg-ink text-lg font-bold text-paper disabled:bg-disabled disabled:text-mute short:h-16"
      :disabled="isBusy"
    >
      {{ isBusy ? 'Anmelden …' : 'Anmelden' }}
    </button>
  </form>
</template>
