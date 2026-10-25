<script setup lang="ts">
defineProps<{ label: string; disabled?: boolean }>()
const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <!-- Sticks to the bottom of the scrolling view. No extra safe-area padding:
       the app frame already ends above the home indicator. -->
  <div class="sticky bottom-0 z-5 border-t border-line bg-well pt-3 px-gutter pb-4">
    <button
      type="button"
      class="flex h-[88px] w-full items-center justify-center gap-2.5 rounded-lg bg-ink text-lg font-bold text-paper disabled:cursor-default disabled:bg-disabled disabled:text-mute short:h-16"
      :disabled="disabled"
      @click="emit('save')"
    >
      {{ label }}
    </button>
  </div>
</template>
