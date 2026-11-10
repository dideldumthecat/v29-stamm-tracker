<script setup lang="ts">
import { computed, ref } from 'vue'
import { ImageIcon, ImageOffIcon } from '@lucide/vue'

import { formatDateTime } from '@/activity'
import PhotoGallery from '@/components/PhotoGallery.vue'
import type { PhotoRecord } from '@/detail'

const props = defineProps<{ photos: PhotoRecord[]; tag: string }>()
const ids = computed(() => props.photos.map((photo) => photo.id))

// Frame of the stage (also for the empty and the not-uploaded state)
const stage = 'h-[420px] min-h-60 w-full overflow-hidden rounded-xl border border-line'

const selected = ref(0)
const galleryOpen = ref(false)
// A photo can be recorded before its file is uploaded: the file answers 404, the image fails to load.
const missing = ref(new Set<string>())
const markMissing = (id: string) => (missing.value = new Set(missing.value).add(id))
</script>

<template>
  <section aria-label="Fotos">
    <!-- No photos: the same frame and height as the stage, nothing to click. -->
    <div
      v-if="!ids.length"
      role="img"
      aria-label="Noch keine Fotos"
      :class="[stage, 'flex flex-col items-center justify-center gap-3 text-dim']"
    >
      <ImageOffIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
      <p aria-hidden="true">Noch keine Fotos</p>
    </div>
    <template v-else>
      <div
        v-if="missing.has(ids[selected])"
        :class="[stage, 'flex flex-col items-center justify-center gap-3 text-dim']"
      >
        <ImageIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
        <p>Foto noch nicht hochgeladen</p>
      </div>
      <!-- The whole frame opens the gallery; the cursor is the only hint. object-contain: the photo is never cropped.
           While the section is sticky it is a flex column with a maximum height (set by the page): the frame gives way, down to 240 px. -->
      <button
        v-else
        type="button"
        :class="[stage, 'flex cursor-zoom-in items-center justify-center']"
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
      </button>

      <!-- shrink-0: in the sticky column only the stage gives way. -->
      <p class="mt-2 shrink-0 text-center text-caption text-mute tabular-nums">
        Foto {{ selected + 1 }} von {{ ids.length }} ·
        {{ formatDateTime(photos[selected].recorded_at) }}
      </p>

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="(id, position) in ids"
          :key="id"
          type="button"
          class="group flex flex-col items-center gap-1"
          :aria-label="`Foto ${position + 1}`"
          :aria-pressed="position === selected"
          @click="selected = position"
        >
          <span
            v-if="missing.has(id)"
            class="flex size-16 items-center justify-center rounded-lg bg-soft"
          >
            <ImageIcon :size="20" class="text-dim" aria-hidden="true" />
          </span>
          <img
            v-else
            :src="`/api/photos/${id}`"
            alt=""
            class="size-16 rounded-lg object-cover group-hover:opacity-100"
            :class="position === selected ? '' : 'opacity-75'"
            @error="markMissing(id)"
          />
          <!-- Always there, so the thumbnails do not jump when the selection changes -->
          <span
            class="h-[3px] w-full rounded-full"
            :class="position === selected ? 'bg-ink' : 'bg-transparent'"
            aria-hidden="true"
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
