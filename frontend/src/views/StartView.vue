<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import NumPad from '@/components/NumPad.vue'
import TagNumberDisplay from '@/components/TagNumberDisplay.vue'
import StartHeader from '@/components/StartHeader.vue'
import OpenButton from '@/components/OpenButton.vue'
import { TAG_DIGITS, TAG_MAX_NUMBER } from '@/config/constants'
import { isValidTagNumber as checkTagNumber } from '@/utils/tag'

const router = useRouter()

const tagInput = ref('')

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

    <div class="flex min-h-0 flex-col justify-end overflow-hidden pb-3">
      <TagNumberDisplay :tag-input="tagInput" :has-error="isTagNumberTooHigh" />
      <OpenButton :is-disabled="!isValidTagNumber" @open="onOpen" />
      <NumPad @digit="onDigit" @clear="onClear" @delete="onDelete" />
    </div>
  </div>
</template>
