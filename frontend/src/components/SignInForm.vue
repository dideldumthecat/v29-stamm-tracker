<script setup lang="ts">
import { ref, watch } from 'vue'
import { ApiError } from '@/api/client'
import { useTimberItemStore } from '@/stores/timberItems'
import { formatInviteInput, isInviteCode } from '@/utils/invite'

const emit = defineEmits<{ 'signed-in': [] }>()

const store = useTimberItemStore()

const input = ref('')
watch(input, (text) => (input.value = formatInviteInput(text)))
const error = ref<string | null>(null)
const isBusy = ref(false)

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
    <input
      id="invite-code"
      v-model="input"
      type="text"
      autocapitalize="characters"
      autocomplete="off"
      maxlength="14"
      autocorrect="off"
      spellcheck="false"
      enterkeyhint="go"
      placeholder="K7QM-4XHT-9RDP"
      class="h-16 w-full rounded-lg border-2 border-ink bg-paper px-3.5 text-center text-2xl font-semibold tracking-wide"
    />
    <p v-if="error" class="text-sm leading-[1.4] font-semibold" role="alert">{{ error }}</p>
    <button
      type="submit"
      class="flex h-[88px] w-full items-center justify-center rounded-lg bg-ink text-lg font-bold text-paper disabled:bg-disabled disabled:text-mute short:h-16"
      :disabled="isBusy"
    >
      {{ isBusy ? 'Anmelden …' : 'Anmelden' }}
    </button>
  </form>
</template>
