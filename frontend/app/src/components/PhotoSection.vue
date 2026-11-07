<script setup lang="ts">
import { computed, onUnmounted, useTemplateRef, watch } from 'vue'
import { CameraIcon, ImagesIcon, LoaderCircleIcon, XIcon } from '@lucide/vue'
import type { Attribute, StoredPhoto } from '@/stores/timberItems'

type Preview = Pick<StoredPhoto, 'id' | 'blob'>

/**
 * Photo attribute: previews only for photos still on this device (a preview means "not uploaded yet"),
 * everything the server already has as one stack tile with its count, then the camera and gallery buttons.
 */
const props = defineProps<{
  attribute: Attribute
  // Photos on this device, saved or still in the draft. `removable`: removing leaves no trace.
  pending: { photo: Preview; removable: boolean }[]
  uploadedCount: number
  // Camera and gallery buttons: off for a split stem and an inactive attribute.
  canCapture: boolean
  // Photos are being compressed: no new ones meanwhile.
  busy: boolean
}>()
// `add`: the files from the camera (one) or the gallery (any number).
const emit = defineEmits<{
  add: [files: File[]]
  remove: [photoId: string]
  // The system camera or library is open (true) or has answered (false); the page may be reloaded meanwhile.
  picker: [open: boolean]
}>()

const camera = useTemplateRef<HTMLInputElement>('camera')
const gallery = useTemplateRef<HTMLInputElement>('gallery')

function open(input: HTMLInputElement | null) {
  emit('picker', true)
  input?.click()
}

function onChange(input: HTMLInputElement | null) {
  emit('picker', false)
  const files = [...(input?.files ?? [])]
  if (files.length > 0) {
    emit('add', files)
  }
  // Reset, so choosing the same file again fires `change` again.
  input!.value = ''
}

// Object URLs live as long as the photo is shown, then they are released.
const urls = new Map<string, string>()
const urlOf = (photo: Preview) => {
  if (!urls.has(photo.id)) {
    urls.set(photo.id, URL.createObjectURL(photo.blob))
  }
  return urls.get(photo.id)
}
watch(
  () => props.pending.map((entry) => entry.photo.id),
  (ids) => {
    for (const [id, url] of urls) {
      if (!ids.includes(id)) {
        URL.revokeObjectURL(url)
        urls.delete(id)
      }
    }
  },
)
onUnmounted(() => urls.forEach((url) => URL.revokeObjectURL(url)))

// Only a stack and no previews: one row, buttons to the right of the stack.
const beside = computed(() => props.uploadedCount > 0 && props.pending.length === 0)
const photoCount = computed(() => props.uploadedCount + props.pending.length)

const captureButton =
  'flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink bg-paper text-center leading-tight font-bold break-words disabled:border-lockline disabled:text-mute'
</script>

<template>
  <section
    class="flex flex-col gap-2.5 border-t border-line py-section px-gutter *:max-w-full *:min-w-0"
  >
    <h2 class="text-heading font-bold">
      {{ attribute.name }}<template v-if="photoCount > 0"> ({{ photoCount }})</template>
    </h2>
    <p v-if="attribute.description" class="text-sm leading-copy text-body">
      {{ attribute.description }}
    </p>
    <template v-if="canCapture">
      <!-- `capture` opens the camera directly; without it the system offers the photo library. -->
      <input
        ref="camera"
        type="file"
        accept="image/*"
        capture="environment"
        class="hidden"
        @change="onChange(camera)"
        @cancel="emit('picker', false)"
      />
      <input
        ref="gallery"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onChange(gallery)"
        @cancel="emit('picker', false)"
      />
    </template>

    <div
      v-if="uploadedCount > 0 || pending.length > 0 || canCapture"
      class="grid grid-cols-4 gap-2"
    >
      <!--
        Stack: front tile bottom left, two offset outlines behind it to the top right, all inside
        the square cell, so the cell edges line up with the neighbours.
      -->
      <div v-if="uploadedCount > 0" class="relative aspect-square">
        <span
          aria-hidden="true"
          class="absolute top-0 right-0 h-[calc(100%-6px)] w-[calc(100%-6px)] rounded-lg border-2 border-lockline"
        ></span>
        <span
          aria-hidden="true"
          class="absolute top-[3px] right-[3px] h-[calc(100%-6px)] w-[calc(100%-6px)] rounded-lg border-2 border-lockline bg-paper"
        ></span>
        <div
          class="absolute bottom-0 left-0 flex h-[calc(100%-6px)] w-[calc(100%-6px)] items-center justify-center rounded-lg bg-soft text-xl font-bold tabular-nums"
          role="img"
          :aria-label="`${uploadedCount} ${uploadedCount === 1 ? 'Foto' : 'Fotos'} hochgeladen`"
        >
          {{ uploadedCount }}
        </div>
      </div>
      <div
        v-for="{ photo, removable } in pending"
        :key="photo.id"
        class="relative aspect-square rounded-lg"
      >
        <img
          :src="urlOf(photo)"
          alt="Foto, noch nicht hochgeladen"
          class="size-full rounded-lg object-cover"
        />
        <button
          v-if="removable"
          type="button"
          class="absolute -top-1.5 -right-1.5 flex size-9 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink"
          aria-label="Foto entfernen"
          @click="emit('remove', photo.id)"
        >
          <XIcon :size="18" :stroke-width="2.5" aria-hidden="true" />
        </button>
      </div>
      <!-- Next to a lone stack the buttons share its row and height; otherwise they get a row of their own. -->
      <div
        v-if="canCapture"
        class="grid grid-cols-2 gap-2"
        :class="beside ? 'col-span-3' : 'col-span-4'"
      >
        <button
          type="button"
          :class="[captureButton, beside ? 'px-1 text-sm' : 'min-h-[72px] px-2 text-base']"
          :disabled="busy"
          @click="open(camera)"
        >
          <CameraIcon :size="22" :stroke-width="2.5" aria-hidden="true" />
          Foto aufnehmen
        </button>
        <button
          type="button"
          :class="[captureButton, beside ? 'px-1 text-sm' : 'min-h-[72px] px-2 text-base']"
          :disabled="busy"
          @click="open(gallery)"
        >
          <LoaderCircleIcon
            v-if="busy"
            :size="22"
            :stroke-width="2.5"
            class="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <ImagesIcon v-else :size="22" :stroke-width="2.5" aria-hidden="true" />
          Aus Galerie
        </button>
      </div>
    </div>
  </section>
</template>
