<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { KeyRoundIcon } from '@lucide/vue'
import NumPad from '@/components/NumPad.vue'
import TagNumberDisplay from '@/components/TagNumberDisplay.vue'
import StartHeader from '@/components/StartHeader.vue'
import OpenButton from '@/components/OpenButton.vue'
import SignInForm from '@/components/SignInForm.vue'
import IosInstallSteps from '@/components/IosInstallSteps.vue'
import AndroidInstallSteps from '@/components/AndroidInstallSteps.vue'
import { TAG_DIGITS, TAG_MAX_NUMBER } from '@/config/constants'
import { isValidTagNumber as checkTagNumber } from '@/utils/tag'
import { useTimberItemStore } from '@/stores/timberItems'
import { isInstalledApp, isIos } from '@/utils/platform'

const router = useRouter()
const store = useTimberItemStore()

const tagInput = ref('')
// Not bound to store.currentUser directly: the form would be gone before it reports the sign-in.
const isSignedIn = ref(store.currentUser !== null)
const isInBrowser = !isInstalledApp()
// The installed app has its own cookies and storage, separate from the browser (on iOS always):
// signing in here would sign in the browser only. Dev server and fake API keep the form for local work and tests.
const showsSignIn = !isInBrowser || import.meta.env.DEV || import.meta.env.VITE_API === 'fake'

const tagNumber = computed(() => {
  return Number(tagInput.value)
})

const isValidTagNumber = computed(() => {
  return checkTagNumber(tagNumber.value)
})

const isTagNumberTooHigh = computed(() => {
  return tagNumber.value > TAG_MAX_NUMBER
})

function onDigit(digit: string) {
  if ((tagInput.value === '' && digit === '0') || tagInput.value.length >= TAG_DIGITS) {
    return
  }
  tagInput.value += digit
}

function onClear() {
  tagInput.value = ''
}

function onDelete() {
  tagInput.value = tagInput.value.slice(0, -1)
}

// A new device has no attributes yet. Best effort: the sync page shows any problem later,
// except rejected duplicate captures, whose data is gone – those are shown right away.
async function onSignedIn() {
  isSignedIn.value = true
  const result = await store.sync().catch(() => null)
  if (result?.rejected.length) {
    await router.push({ name: 'sync', state: { syncResult: result } })
  }
}

function onOpen() {
  if (!isValidTagNumber.value) {
    return
  }
  // Navigate by route name instead of a hand-built path, so the URL scheme
  // can change in one place (router/index.ts) later.
  router.push({ name: 'timber-item', params: { tagNumber: String(tagNumber.value) } })
}
</script>

<template>
  <!-- Contents of the start screen: own header + input area. The outer frame lives in App.vue. -->
  <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
    <StartHeader />

    <div
      v-if="!isSignedIn"
      class="flex flex-col items-center gap-4 overflow-y-auto py-8 px-gutter text-center"
      :class="isInBrowser ? 'justify-start' : 'justify-center-safe'"
    >
      <KeyRoundIcon v-if="!isInBrowser" :size="64" :stroke-width="1.5" aria-hidden="true" />
      <h2 class="text-[26px] font-bold text-balance">Willkommen</h2>
      <section
        v-if="isInBrowser"
        class="flex w-full flex-col gap-3 rounded-lg border-2 border-ink p-4 text-left"
        role="note"
      >
        <h2 class="text-xl font-bold text-balance">Bitte zuerst die App installieren</h2>
        <ol class="flex list-decimal flex-col gap-3 pl-6 text-lg leading-[1.4]">
          <IosInstallSteps v-if="isIos()" />
          <AndroidInstallSteps v-else />
          <li>Dort mit dem Einladungscode anmelden, den du von V29 bekommen hast.</li>
        </ol>
      </section>
      <template v-if="showsSignIn">
        <p class="max-w-[32ch] leading-[1.45] text-mute">
          Melde dich mit dem Einladungscode an, den du von V29 bekommen hast.
        </p>
        <SignInForm @signed-in="onSignedIn" />
      </template>
    </div>
    <div v-else class="flex min-h-0 flex-col justify-end overflow-hidden pb-3">
      <TagNumberDisplay :tag-input="tagInput" :has-error="isTagNumberTooHigh" />
      <OpenButton :is-disabled="!isValidTagNumber" @open="onOpen" />
      <NumPad @digit="onDigit" @clear="onClear" @delete="onDelete" />
    </div>
  </div>
</template>
