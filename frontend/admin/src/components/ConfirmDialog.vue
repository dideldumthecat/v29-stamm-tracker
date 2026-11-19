<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'

/**
 * A question before something that cannot be taken back (Reka UI AlertDialog, like DiscardDialog: the focus starts on the safe button,
 * Escape cancels). The texts are the caller's.
 */
const open = defineModel<boolean>('open', { required: true })
defineProps<{ title: string; confirm: string; cancel: string; danger?: boolean }>()
defineEmits<{ confirm: [] }>()
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay class="fixed inset-0 z-70 bg-ink/50" />
      <AlertDialogContent
        class="fixed top-1/2 left-1/2 z-70 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-ink bg-paper p-6 text-ink"
      >
        <AlertDialogTitle class="text-xl font-bold">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 leading-message text-mute">
          <slot />
        </AlertDialogDescription>
        <div class="mt-6 flex flex-wrap justify-end gap-3">
          <AlertDialogCancel class="h-11 rounded-lg border-2 border-ink px-4 font-bold">
            {{ cancel }}
          </AlertDialogCancel>
          <AlertDialogAction
            class="h-11 rounded-lg border-2 px-4 font-bold text-paper"
            :class="danger ? 'border-alert bg-alert' : 'border-ink bg-ink'"
            @click="$emit('confirm')"
          >
            {{ confirm }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
