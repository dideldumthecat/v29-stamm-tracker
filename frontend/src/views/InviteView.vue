<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircleIcon, TriangleAlertIcon } from '@lucide/vue'
import { ApiError } from '@/api/client'
import IosInstallSteps from '@/components/IosInstallSteps.vue'
import { useTimberItemStore } from '@/stores/timberItems'

const props = defineProps<{
  // From the personal invite link /invite#<code>.
  token: string
}>()

const router = useRouter()
const store = useTimberItemStore()

const error = ref<'revoked' | 'offline' | null>(null)

// The home screen app on iOS has its own cookies and storage, separate from Safari: redeeming here would
// sign in Safari only. So Safari (and other iOS browsers) only explains how to add the app and shows the code.
const isIosBrowser =
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(navigator as Navigator & { standalone?: boolean }).standalone
const isCopied = ref(false)

async function copyCode() {
  await navigator.clipboard.writeText(props.token)
  isCopied.value = true
}

async function redeem() {
  error.value = null
  try {
    await store.redeemInvite(props.token)
  } catch (failure) {
    // 401 = unknown or revoked; anything else is worth another try once there is reception.
    error.value = failure instanceof ApiError && failure.status === 401 ? 'revoked' : 'offline'
    return
  }
  // A new device has no attributes yet. Best effort: the sync page shows any problem later,
  // except rejected duplicate captures, whose data is gone – those are shown right away.
  const result = await store.sync().catch(() => null)
  // replace: the token must not stay in the history.
  await router.replace(
    result?.rejected.length ? { name: 'sync', state: { syncResult: result } } : { name: 'start' },
  )
}

onMounted(() => isIosBrowser || redeem())
</script>

<template>
  <div v-if="isIosBrowser" class="flex min-h-0 flex-col overflow-y-auto">
    <div class="flex flex-auto flex-col gap-5 py-8 px-gutter">
      <h1 class="text-center text-[26px] font-bold text-balance">
        App zum Home-Bildschirm hinzufügen
      </h1>
      <ol class="flex list-decimal flex-col gap-3 pl-6 text-lg leading-[1.4]">
        <IosInstallSteps />
        <li>Diesen Code kopieren und dort einfügen:</li>
      </ol>
      <p
        class="rounded-lg border-2 border-ink py-4 text-center text-3xl font-bold tracking-wider break-all select-all"
      >
        {{ token }}
      </p>
      <button
        type="button"
        class="flex h-[88px] w-full items-center justify-center rounded-lg bg-ink text-lg font-bold text-paper short:h-16"
        @click="copyCode"
      >
        {{ isCopied ? 'Code kopiert' : 'Code kopieren' }}
      </button>
    </div>
  </div>
  <div v-else class="flex min-h-0 flex-col">
    <div
      class="flex flex-auto flex-col items-center justify-center gap-4 py-8 px-gutter text-center"
    >
      <template v-if="!error">
        <LoaderCircleIcon
          :size="64"
          :stroke-width="1.5"
          class="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <h1 class="text-[26px] font-bold text-balance">Einladung wird geprüft …</h1>
      </template>
      <template v-else>
        <TriangleAlertIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
        <h1 class="text-[26px] font-bold text-balance">Kein Zugang</h1>
        <p v-if="error === 'revoked'" class="max-w-[32ch] leading-[1.45] text-mute" role="alert">
          Dieser Einladungslink ist ungültig oder wurde widerrufen. Bitte frag bei V29 nach einem
          neuen Link.
        </p>
        <p v-else class="max-w-[32ch] leading-[1.45] text-mute" role="alert">
          Keine Verbindung zum Server. Versuch es erneut, sobald du Empfang hast.
        </p>
      </template>
    </div>
    <div
      v-if="error === 'offline'"
      class="sticky bottom-0 z-5 border-t border-line bg-well pt-3 px-gutter pb-safe-4"
    >
      <button
        type="button"
        class="flex h-[88px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper short:h-16"
        @click="redeem"
      >
        Erneut versuchen
      </button>
    </div>
  </div>
</template>
