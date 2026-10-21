<script lang="ts" setup>
defineProps<{
  isDisabled: boolean
}>()
const emit = defineEmits<{ open: [] }>()
</script>

<template>
  <div class="pb-3 px-gutter">
    <button
      type="button"
      class="flex h-[72px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper disabled:cursor-default disabled:bg-disabled disabled:text-mute shorter:h-[60px]"
      :disabled="isDisabled"
      @click="emit('open')"
    >
      Stamm öffnen
    </button>
  </div>
</template>
