<script setup lang="ts">
import { computed } from 'vue'
import { CalendarIcon, CameraIcon, ChevronDownIcon, GripVerticalIcon, LockIcon } from '@lucide/vue'
import type { AdminAttribute } from '@v29/shared/contract'

/**
 * One attribute of the preview, drawn as the app shows it empty (choice, number, month, date, text, yes/no, photos), for looking only:
 * the whole field is one button that selects it. Colors and sizes are those of the app (shared/theme.css); the handle at the left
 * is a second button beside it (never inside: buttons do not nest) that sorts the attributes. The inner parts are no real inputs (they would be buttons inside a button), so they are hidden from
 * assistive technology: the button carries the name.
 */
const props = defineProps<{
  attribute: AdminAttribute
  selected: boolean
  /** An attribute of the stem alone that the beams inherit: the app shows it on a beam read-only (grey, no input, "Vom Stamm geerbt"). */
  inherited?: boolean
  /** The handle works (not for the draft of a new attribute and while the order is being saved). */
  movable?: boolean
}>()
const emit = defineEmits<{ select: []; drag: [event: PointerEvent]; move: [direction: -1 | 1] }>()

// The handle is a button: arrow up and down move the attribute by one place, like dragging it
function onKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  emit('move', event.key === 'ArrowUp' ? -1 : 1)
}

const label = computed(
  () =>
    props.attribute.name +
    (props.attribute.is_system ? ' (Systemmerkmal)' : '') +
    (props.inherited ? ' (vom Stamm geerbt)' : '') +
    (props.attribute.active ? '' : ' (deaktiviert)'),
)
const placeholder = (text: string) => 'min-w-0 flex-1 truncate text-mute ' + text
const input =
  'flex h-[52px] w-full items-center rounded-lg border-2 border-ink bg-paper pr-3 pl-3 font-semibold'
</script>

<template>
  <!-- py-0.5: 2 px of white between a line and the frame of a selected field, so the line is not taken for part of the frame (the grip stays centered: the wrapper is
       the field plus the same 2 px above and below) -->
  <div class="relative bg-paper py-0.5">
    <button
      type="button"
      class="block w-full cursor-pointer rounded-md py-5 pr-11 pl-11 text-left text-base hover:bg-well focus-visible:outline-offset-[-3px]"
      :class="selected ? 'bg-well ring-2 ring-ink ring-inset' : inherited && 'bg-locked text-mute'"
      :aria-current="selected ? 'true' : undefined"
      :aria-label="label"
      @click="$emit('select')"
    >
      <span class="flex flex-col gap-2.5" aria-hidden="true">
        <!-- Yes/no: the big button with the box; the name is in it -->
        <span
          v-if="attribute.type === 'boolean'"
          class="flex min-h-row items-center gap-3.5 rounded-lg border-2 px-3.5 text-label leading-6 font-bold"
          :class="inherited ? 'border-lockline' : 'border-ink bg-paper'"
        >
          <span
            class="flex size-[30px] shrink-0 items-center justify-center rounded-md border-2"
            :class="inherited ? 'border-lockline' : 'border-ink bg-paper'"
          ></span>
          <span class="min-w-0 flex-1">
            <span :class="!attribute.active && 'line-through'">{{ attribute.name }}</span><LockIcon
              v-if="attribute.is_system"
              :size="16"
              class="ml-1.5 inline-block align-[-2px]"
            />
            <span v-if="!attribute.active" class="block text-sm leading-5 font-normal text-mute"
              >(deaktiviert)</span
            >
          </span>
        </span>

        <template v-else>
          <span class="flex items-baseline gap-2 text-label leading-6 font-bold">
            <span :class="!attribute.active && 'line-through'"
              >{{ attribute.name
              }}<LockIcon
                v-if="attribute.is_system"
                :size="16"
                class="ml-1.5 inline-block align-[-2px]"
            /></span>
            <span v-if="!attribute.active" class="text-sm leading-5 font-normal text-mute"
              >(deaktiviert)</span
            >
          </span>
          <!-- A choice has its description above the field, as in the app -->
          <span
            v-if="attribute.description && attribute.type === 'choice'"
            class="text-sm leading-5 text-body"
            >{{ attribute.description }}</span
          >

          <!-- Inherited: the grey box of the app without a value, nothing to enter -->
          <span
            v-if="inherited"
            class="block min-h-[52px] w-full rounded-lg border-2 border-lockline"
          ></span>
          <span v-else-if="attribute.type === 'choice'" :class="[input, 'relative pr-12']">
            <span :class="placeholder('')">{{ attribute.name }} wählen …</span>
            <ChevronDownIcon class="absolute top-1/2 right-3 size-6 -translate-y-1/2" />
          </span>
          <span v-else-if="attribute.type === 'number'" class="flex gap-2">
            <span :class="[input, 'min-w-0 flex-1']">
              <span :class="placeholder('')">Wert</span>
              <span v-if="attribute.unit">{{ attribute.unit }}</span>
            </span>
            <span
              v-if="attribute.is_series"
              class="flex min-h-11 shrink-0 items-center rounded-lg border-2 border-ink bg-paper px-3.5 text-detail font-semibold"
              >Hinzufügen</span
            >
          </span>
          <span
            v-else-if="attribute.type === 'month' || attribute.type === 'date'"
            :class="[input, 'relative pr-12']"
          >
            <span :class="placeholder('')">{{
              attribute.type === 'month' ? 'MM / JJJJ' : 'TT / MM / JJJJ'
            }}</span>
            <CalendarIcon class="absolute top-1/2 right-3 size-6 -translate-y-1/2" />
          </span>
          <span
            v-else-if="attribute.type === 'text'"
            class="block min-h-[84px] w-full rounded-lg border-2 border-ink bg-paper px-3 py-2.5 text-mute"
            >Beobachtung, Auffälligkeit …</span
          >
          <span
            v-else-if="attribute.type === 'photo'"
            class="flex min-h-[72px] items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink bg-paper px-2 font-bold"
          >
            <CameraIcon :size="22" :stroke-width="2.5" />
            Foto aufnehmen
          </span>
        </template>

        <span
          v-if="attribute.description && attribute.type !== 'choice'"
          class="text-sm leading-5 text-body"
          >{{ attribute.description }}</span
        >
        <span v-if="inherited" class="text-caption text-mute">Vom Stamm geerbt</span>
      </span>
    </button>
    <!-- 22 px grey grip in a 40 px target, centered in the 44 px of padding left of the content and between the top and bottom edge of the field (the
       lines, or the edge of the grey area at the first and last field: the wrapper is exactly the field); touch-none: a finger drags instead of scrolling the page. A grip on a fraction of a pixel is drawn blurred and
       its dots look uneven. So the text lines have whole-pixel heights (leading-5, leading-6; the inherited 1.5 gave 25.5 px), which makes every
       field a whole number of pixels high and puts the next one on a whole pixel, and the middle of the field is rounded to a whole pixel. -->
    <button
      type="button"
      class="absolute top-1/2 left-0.5 flex size-10 -translate-y-1/2 touch-none items-center justify-center rounded-lg text-[#888] enabled:cursor-grab enabled:hover:text-ink disabled:opacity-40 supports-[top:round(50%,1px)]:top-[round(50%,1px)]"
      :aria-label="`${attribute.name || 'Unbenanntes Merkmal'} verschieben`"
      title="Ziehen, oder mit Pfeil hoch und runter verschieben"
      :disabled="!movable"
      @pointerdown="emit('drag', $event)"
      @keydown="onKey"
    >
      <GripVerticalIcon :size="22" aria-hidden="true" />
    </button>
  </div>
</template>
