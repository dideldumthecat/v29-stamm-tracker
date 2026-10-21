<script setup lang="ts">
import NumPad from '@/components/NumPad.vue'
import TagNumberDisplay from '@/components/TagNumberDisplay.vue'
import AppHeader from '@/components/AppHeader.vue'
import { TAG_DIGITS, TAG_MIN_NUMBER, TAG_MAX_NUMBER } from '@/config/constants'
import { ref, computed } from 'vue'
import OpenButton from '@/components/OpenButton.vue'

const tagInput = ref('')

const tagNumber = computed(() => {
  return Number(tagInput.value)
})

const isValidTagNumber = computed(() => {
  return tagNumber.value >= TAG_MIN_NUMBER && tagNumber.value <= TAG_MAX_NUMBER
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
  // TODO Navigate to timber item
  console.log('Open button clicked with tag number:', tagNumber.value)
}
</script>

<template>
  <div
    class="mx-auto grid h-screen-safe max-w-[430px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-paper min-[480px]:border-x min-[480px]:border-line"
  >
    <AppHeader />

    <div class="flex min-h-0 flex-col justify-end overflow-hidden pb-3">
      <TagNumberDisplay :tag-input="tagInput" :has-error="isTagNumberTooHigh" />
      <OpenButton :is-disabled="!isValidTagNumber" @open="onOpen" />
      <NumPad @digit="onDigit" @clear="onClear" @delete="onDelete" />
    </div>
  </div>
</template>
