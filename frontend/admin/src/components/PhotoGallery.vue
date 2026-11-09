<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from '@lucide/vue'

import { formatDateTime } from '@/activity'
import { photoFileName, plaqueTag, type PhotoRecord } from '@/detail'

const props = defineProps<{
  photos: PhotoRecord[]
  /** "104", "104-C": names the download and the heading. */
  tag: string
  /** Photos whose file did not load (not uploaded yet). */
  missing: Set<string>
}>()
const index = defineModel<number>('index', { required: true })
const emit = defineEmits<{ close: []; broken: [id: string] }>()

// Zoom steps of the buttons; the wheel zooms smoothly in between.
const STEPS = [1, 1.5, 2, 3, 4]
const MAX = STEPS[STEPS.length - 1]

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const viewport = useTemplateRef<HTMLElement>('viewport')
const image = useTemplateRef<HTMLImageElement>('image')

const ids = computed(() => props.photos.map((photo) => photo.id))
const id = computed(() => ids.value[index.value])
const isMissing = computed(() => props.missing.has(id.value))
const kind = computed(() => (props.tag.includes('-') ? 'Balken' : 'Stamm'))

// Opened with the native modal: Esc, the backdrop and focus handling come with it.
onMounted(() => {
  if (dialog.value && !dialog.value.open) dialog.value.showModal?.()
})

const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
watch(index, () => reset())

function reset() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
}

// How far the zoomed photo may be moved: until its edge meets the edge of the frame, never into empty space.
function clamp(x: number, y: number, scale: number) {
  const frame = viewport.value
  const shown = image.value
  if (!frame || !shown) return { x: 0, y: 0 }
  const limitX = Math.max(0, (shown.offsetWidth * scale - frame.clientWidth) / 2)
  const limitY = Math.max(0, (shown.offsetHeight * scale - frame.clientHeight) / 2)
  return { x: Math.min(limitX, Math.max(-limitX, x)), y: Math.min(limitY, Math.max(-limitY, y)) }
}

// Zooms so that the point under (px, py), measured from the center of the frame, stays where it is.
function zoomTo(next: number, px = 0, py = 0) {
  const scale = Math.min(MAX, Math.max(1, next))
  if (scale === 1) return reset()
  const ratio = scale / zoom.value
  pan.value = clamp(px - ratio * (px - pan.value.x), py - ratio * (py - pan.value.y), scale)
  zoom.value = scale
}

function stepZoom(direction: 1 | -1) {
  const next =
    direction === 1
      ? STEPS.find((step) => step > zoom.value + 0.01)
      : [...STEPS].reverse().find((step) => step < zoom.value - 0.01)
  zoomTo(next ?? (direction === 1 ? MAX : 1))
}

// Pointer position measured from the center of the frame
function fromCenter(event: MouseEvent) {
  const box = viewport.value!.getBoundingClientRect()
  return {
    x: event.clientX - box.left - box.width / 2,
    y: event.clientY - box.top - box.height / 2,
  }
}

function onWheel(event: WheelEvent) {
  const { x, y } = fromCenter(event)
  zoomTo(zoom.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15), x, y)
}

function onDoubleClick(event: MouseEvent) {
  const { x, y } = fromCenter(event)
  zoomTo(zoom.value === 1 ? 2 : 1, x, y)
}

let drag: { x: number; y: number; from: { x: number; y: number } } | undefined
function onPointerDown(event: PointerEvent) {
  if (zoom.value === 1 || event.button !== 0) return
  drag = { x: event.clientX, y: event.clientY, from: pan.value }
  viewport.value!.setPointerCapture(event.pointerId)
}
function onPointerMove(event: PointerEvent) {
  if (!drag) return
  pan.value = clamp(
    drag.from.x + event.clientX - drag.x,
    drag.from.y + event.clientY - drag.y,
    zoom.value,
  )
}
const onPointerUp = () => (drag = undefined)

const go = (step: number) => {
  const next = index.value + step
  if (next >= 0 && next < ids.value.length) index.value = next
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') go(-1)
  else if (event.key === 'ArrowRight') go(1)
  else if (event.key === '+' || event.key === '=') stepZoom(1)
  else if (event.key === '-') stepZoom(-1)
  else return
  event.preventDefault()
}

const round = (value: number) => Math.round(value * 100)
const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-lg text-paper enabled:active:bg-paper/20 hover:bg-paper/15 disabled:text-mute'
</script>

<template>
  <dialog
    ref="dialog"
    class="m-0 size-full max-h-none max-w-none flex-col overflow-hidden border-0 bg-[#000] p-0 text-paper backdrop:bg-[#000] open:flex"
    aria-label="Fotogalerie"
    @close="emit('close')"
    @keydown="onKeydown"
  >
    <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
      <p class="text-faint tabular-nums">
        {{ kind }} <strong class="font-bold text-paper">{{ plaqueTag(tag) }}</strong> · Foto
        {{ index + 1 }} von {{ ids.length }} vom {{ formatDateTime(photos[index].recorded_at) }}
      </p>
      <div class="flex items-center gap-1">
        <button type="button" :class="iconButton" aria-label="Verkleinern" @click="stepZoom(-1)">
          <MinusIcon :size="22" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="h-11 min-w-14 rounded-lg px-2 text-center tabular-nums hover:bg-paper/15"
          :aria-label="`Zoom ${round(zoom)} %, auf Einpassen zurücksetzen`"
          @click="reset"
        >
          {{ round(zoom) }} %
        </button>
        <button type="button" :class="iconButton" aria-label="Vergrößern" @click="stepZoom(1)">
          <PlusIcon :size="22" aria-hidden="true" />
        </button>
        <span class="mx-2 h-6 w-px bg-mute" aria-hidden="true" />
        <component
          :is="isMissing ? 'span' : 'a'"
          class="flex h-11 items-center gap-2 rounded-lg bg-paper px-4 font-bold text-ink"
          :class="{ 'opacity-40': isMissing }"
          :href="isMissing ? undefined : `/api/photos/${id}`"
          :download="isMissing ? undefined : photoFileName(tag, index + 1)"
          :aria-disabled="isMissing || undefined"
        >
          <DownloadIcon :size="20" aria-hidden="true" />
          Herunterladen
        </component>
        <button type="button" :class="iconButton" aria-label="Schließen" @click="dialog?.close()">
          <XIcon :size="22" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="relative min-h-0 flex-1">
      <div
        ref="viewport"
        class="absolute inset-0 flex touch-none items-center justify-center overflow-hidden select-none"
        :class="zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'"
        @wheel.prevent="onWheel"
        @dblclick="onDoubleClick"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div v-if="isMissing" class="flex flex-col items-center gap-3 text-faint">
          <ImageIcon :size="64" :stroke-width="1.5" aria-hidden="true" />
          <p>Foto noch nicht hochgeladen</p>
        </div>
        <img
          v-else
          :key="id"
          ref="image"
          :src="`/api/photos/${id}`"
          :alt="`Foto ${index + 1} von ${ids.length}`"
          draggable="false"
          class="max-h-full max-w-full"
          :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
          @error="emit('broken', id)"
        />
      </div>
      <button
        type="button"
        :class="iconButton"
        class="absolute top-1/2 left-3 -translate-y-1/2 bg-[#000]/60"
        aria-label="Vorheriges Foto"
        :disabled="index === 0"
        @click="go(-1)"
      >
        <ChevronLeftIcon :size="28" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="iconButton"
        class="absolute top-1/2 right-3 -translate-y-1/2 bg-[#000]/60"
        aria-label="Nächstes Foto"
        :disabled="index === ids.length - 1"
        @click="go(1)"
      >
        <ChevronRightIcon :size="28" aria-hidden="true" />
      </button>
    </div>

    <div class="flex justify-center gap-2 overflow-x-auto px-4 py-3">
      <button
        v-for="(photo, position) in ids"
        :key="photo"
        type="button"
        class="flex h-[66px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-md border-2 bg-ink"
        :class="
          position === index ? 'border-paper' : 'border-transparent opacity-60 hover:opacity-100'
        "
        :aria-label="`Foto ${position + 1}`"
        :aria-pressed="position === index"
        @click="index = position"
      >
        <ImageIcon v-if="missing.has(photo)" :size="24" class="text-faint" aria-hidden="true" />
        <img
          v-else
          :src="`/api/photos/${photo}`"
          alt=""
          class="size-full object-contain"
          @error="emit('broken', photo)"
        />
      </button>
    </div>
  </dialog>
</template>
