<script setup lang="ts">
import { computed, ref } from 'vue'
import { ImageIcon, ZoomInIcon } from '@lucide/vue'

import PhotoGallery from '@/components/PhotoGallery.vue'
import type { PhotoRecord } from '@/detail'

const props = defineProps<{ photos: PhotoRecord[]; tag: string }>()
const ids = computed(() => props.photos.map((photo) => photo.id))

const selected = ref(0)
const galleryOpen = ref(false)
// A photo can be recorded before its file is uploaded: the file answers 404, the image fails to load.
const missing = ref(new Set<string>())
const markMissing = (id: string) => (missing.value = new Set(missing.value).add(id))
</script>

<template>
  <section class="card p-4 sm:p-6" aria-labelledby="photos-heading">
    <h2 id="photos-heading" class="text-lg font-bold">Fotos ({{ ids.length }})</h2>
    <p v-if="!ids.length" class="mt-3 text-mute">Keine Fotos.</p>
    <template v-else>
      <div
        v-if="missing.has(ids[selected])"
        class="mt-3 flex h-[420px] w-full flex-col items-center justify-center gap-3 bg-well text-dim"
      >
        <ImageIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
        <p>Foto noch nicht hochgeladen</p>
      </div>
      <!-- The whole frame opens the gallery; the lens is only the hint. object-contain: the photo is never cropped. -->
      <button
        v-else
        type="button"
        class="relative mt-3 flex h-[420px] w-full cursor-zoom-in items-center justify-center bg-well"
        aria-label="Foto vergrößern"
        @click="galleryOpen = true"
      >
        <img
          :key="ids[selected]"
          :src="`/api/photos/${ids[selected]}`"
          alt=""
          class="size-full object-contain"
          @error="markMissing(ids[selected])"
        />
        <span
          class="absolute right-3 bottom-3 flex size-10 items-center justify-center rounded-md bg-paper text-ink"
          aria-hidden="true"
        >
          <ZoomInIcon :size="20" />
        </span>
      </button>

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="(id, position) in ids"
          :key="id"
          type="button"
          class="flex h-[54px] w-[72px] items-center justify-center border-2 p-0.5"
          :class="position === selected ? 'border-ink bg-paper' : 'border-transparent'"
          :aria-label="`Foto ${position + 1}`"
          :aria-pressed="position === selected"
          @click="selected = position"
        >
          <ImageIcon v-if="missing.has(id)" :size="20" class="text-dim" aria-hidden="true" />
          <img
            v-else
            :src="`/api/photos/${id}`"
            alt=""
            class="size-full bg-well object-contain"
            @error="markMissing(id)"
          />
        </button>
      </div>
    </template>

    <PhotoGallery
      v-if="galleryOpen"
      v-model:index="selected"
      :photos="photos"
      :tag="tag"
      :missing="missing"
      @broken="markMissing"
      @close="galleryOpen = false"
    />
  </section>
</template>
