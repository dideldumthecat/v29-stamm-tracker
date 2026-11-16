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
 * "Änderungen verwerfen?" before a switch would lose what was typed (Reka UI AlertDialog: traps the focus, Escape means "Weiter bearbeiten",
 * the focus starts on that safe button). Own dialog instead of `window.confirm`: it looks like the page and can be tested.
 */
const open = defineModel<boolean>('open', { required: true })
defineEmits<{ discard: [] }>()
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay class="fixed inset-0 z-70 bg-ink/50" />
      <AlertDialogContent
        class="fixed top-1/2 left-1/2 z-70 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-ink bg-paper p-6 text-ink"
      >
        <AlertDialogTitle class="text-xl font-bold">Änderungen verwerfen?</AlertDialogTitle>
        <AlertDialogDescription class="mt-2 leading-message text-mute">
          Deine Änderungen an diesem Merkmal sind noch nicht gespeichert.
        </AlertDialogDescription>
        <div class="mt-6 flex flex-wrap justify-end gap-3">
          <AlertDialogCancel class="h-11 rounded-lg border-2 border-ink px-4 font-bold">
            Weiter bearbeiten
          </AlertDialogCancel>
          <AlertDialogAction
            class="h-11 rounded-lg border-2 border-ink bg-ink px-4 font-bold text-paper"
            @click="$emit('discard')"
          >
            Verwerfen
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
