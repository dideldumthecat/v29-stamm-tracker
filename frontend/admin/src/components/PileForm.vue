<script setup lang="ts">
import { computed, useId } from 'vue'
import { ExternalLinkIcon } from '@lucide/vue'

import { coordinateHint, mapUrl, type PileDraft } from '@/piles'
import { parseCoordinate } from '@/coordinates'

/**
 * The fields of a pile, the same form for a new one and an open one, in the rows of the card of a user: label on the left, field on the right.
 * Number (required) and location, the position as two fields (decimal degrees or degrees, minutes, seconds, see `parseCoordinate`) with the
 * decimal value under each once it can be read, and the stacked volume (Raummeter). With `map` the link to the position stands under the
 * coordinates once both can be read. What the fields hold and how they are read is the page's business (`fieldsOf`); the form shows the errors it
 * is given by field.
 */
const props = defineProps<{
  modelValue: PileDraft
  errors: Record<string, string>
  /** The submit button waits (a request is running or nothing has changed). */
  disabled: boolean
  /** Show the link to the map (the form of an open pile). */
  map?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [draft: PileDraft]; submit: []; cancel: [] }>()

const id = useId()
const set = (field: keyof PileDraft, value: string) =>
  emit('update:modelValue', { ...props.modelValue, [field]: value })
const link = computed(() => {
  const latitude = parseCoordinate(props.modelValue.latitude)
  const longitude = parseCoordinate(props.modelValue.longitude)
  return latitude === null || longitude === null ? null : mapUrl({ latitude, longitude })
})

const button =
  'flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 font-bold whitespace-nowrap'
const field =
  'h-11 w-full rounded-lg border-2 border-ink bg-paper px-3 text-base text-ink aria-invalid:bg-well'
const caption = 'text-caption font-semibold text-mute'
const row = 'grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]'

const coordinates = [
  { key: 'latitude', text: 'Breite (Nord)', placeholder: `51°24'47"` },
  { key: 'longitude', text: 'Länge (Ost)', placeholder: `13°03'38"` },
] as const
</script>

<template>
  <form @submit.prevent="emit('submit')">
    <div class="divide-y divide-soft [&>*]:py-4 [&>:first-child]:pt-0 [&>:last-child]:pb-0">
      <div :class="row">
        <label :for="`${id}-number`" :class="[caption, 'sm:pt-3']">
          Nummer <span aria-hidden="true">*</span>
        </label>
        <div>
          <input
            :id="`${id}-number`"
            :value="modelValue.number"
            type="text"
            autocomplete="off"
            aria-required="true"
            :class="[field, 'sm:max-w-[260px]']"
            :aria-invalid="!!errors.number"
            :aria-describedby="errors.number ? `${id}-number-error` : undefined"
            @input="set('number', ($event.target as HTMLInputElement).value)"
          />
          <p
            v-if="errors.number"
            :id="`${id}-number-error`"
            class="mt-1 text-sm font-semibold"
            role="alert"
          >
            {{ errors.number }}
          </p>
        </div>
      </div>

      <div :class="row">
        <label :for="`${id}-location`" :class="[caption, 'sm:pt-3']">Lagerort</label>
        <div>
          <input
            :id="`${id}-location`"
            :value="modelValue.location"
            type="text"
            autocomplete="off"
            :class="[field, 'sm:max-w-[420px]']"
            :aria-invalid="!!errors.location"
            :aria-describedby="errors.location ? `${id}-location-error` : undefined"
            @input="set('location', ($event.target as HTMLInputElement).value)"
          />
          <p
            v-if="errors.location"
            :id="`${id}-location-error`"
            class="mt-1 text-sm font-semibold"
            role="alert"
          >
            {{ errors.location }}
          </p>
        </div>
      </div>

      <div :class="row">
        <p :class="[caption, 'sm:pt-3']">Koordinaten</p>
        <div>
          <div class="flex flex-wrap items-start gap-x-4 gap-y-4">
            <div
              v-for="coordinate in coordinates"
              :key="coordinate.key"
              class="flex w-full flex-col gap-1.5 sm:w-50"
            >
              <label :for="`${id}-${coordinate.key}`" class="text-caption text-mute">{{
                coordinate.text
              }}</label>
              <input
                :id="`${id}-${coordinate.key}`"
                :value="modelValue[coordinate.key]"
                type="text"
                autocomplete="off"
                :placeholder="coordinate.placeholder"
                :class="field"
                :aria-invalid="!!errors[coordinate.key]"
                :aria-describedby="
                  errors[coordinate.key] ? `${id}-${coordinate.key}-error` : undefined
                "
                @input="set(coordinate.key, ($event.target as HTMLInputElement).value)"
              />
              <p
                v-if="errors[coordinate.key]"
                :id="`${id}-${coordinate.key}-error`"
                class="text-sm font-semibold"
                role="alert"
              >
                {{ errors[coordinate.key] }}
              </p>
              <p
                v-else-if="coordinateHint(modelValue[coordinate.key])"
                class="text-caption text-mute tabular-nums"
              >
                {{ coordinateHint(modelValue[coordinate.key]) }}
              </p>
            </div>
          </div>
          <p v-if="map && link" class="mt-2">
            <a
              :href="link"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1.5 underline"
            >
              In OpenStreetMap öffnen
              <ExternalLinkIcon :size="16" aria-hidden="true" />
            </a>
          </p>
        </div>
      </div>

      <div :class="row">
        <label :for="`${id}-stackedVolume`" :class="[caption, 'sm:pt-3']">Raummeter</label>
        <div>
          <div class="flex items-center gap-2.5">
            <input
              :id="`${id}-stackedVolume`"
              :value="modelValue.stackedVolume"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              :class="[field, 'max-w-35']"
              :aria-invalid="!!errors.stacked_volume"
              :aria-describedby="errors.stacked_volume ? `${id}-stackedVolume-error` : undefined"
              @input="set('stackedVolume', ($event.target as HTMLInputElement).value)"
            />
            <span class="text-mute">Rm</span>
          </div>
          <p
            v-if="errors.stacked_volume"
            :id="`${id}-stackedVolume-error`"
            class="mt-1 text-sm font-semibold"
            role="alert"
          >
            {{ errors.stacked_volume }}
          </p>
        </div>
      </div>
    </div>

    <div class="mt-6 flex justify-end gap-3">
      <button type="button" :class="[button, 'border-ink']" @click="emit('cancel')">
        Abbrechen
      </button>
      <button
        type="submit"
        :class="[
          button,
          'border-ink bg-ink text-paper disabled:border-line disabled:bg-well disabled:text-dim',
        ]"
        :disabled="disabled"
      >
        Speichern
      </button>
    </div>
  </form>
</template>
