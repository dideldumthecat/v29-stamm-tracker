<script setup lang="ts">
import type { Component } from 'vue'
import { CalendarIcon, ChevronDownIcon, NumbersIcon, SquareCheckIcon, TextIcon } from '@lucide/vue'

import { TILES, type TileType } from '@/attributes'

/**
 * Step 1 of a new attribute: the type as tiles (two columns), each with a symbol, its name and an example from the real attributes.
 * `current` marks the type of a draft that is being changed ("ändern" in the form).
 */
withDefaults(defineProps<{ current?: TileType; title?: string }>(), {
  current: undefined,
  title: 'Neues Merkmal',
})
defineEmits<{ pick: [type: TileType]; cancel: [] }>()

const icons: Record<TileType, Component> = {
  choice: ChevronDownIcon,
  boolean: SquareCheckIcon,
  number: NumbersIcon,
  text: TextIcon,
  date: CalendarIcon,
}
</script>

<template>
  <section class="card lg:flex lg:min-h-0 lg:flex-col" aria-labelledby="new-attribute-heading">
    <div data-card-scroll class="px-5 pt-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <h2 id="new-attribute-heading" class="text-xl font-bold">{{ title }}</h2>
      <ul class="mt-5 grid gap-3 sm:grid-cols-2">
        <li v-for="tile in TILES" :key="tile.type">
          <button
            type="button"
            class="flex h-full w-full items-start gap-3 rounded-lg border-2 bg-paper p-4 text-left"
            :class="tile.type === current ? 'border-ink bg-well' : 'border-ink'"
            :aria-pressed="current ? tile.type === current : undefined"
            @click="$emit('pick', tile.type)"
          >
            <component :is="icons[tile.type]" :size="28" class="shrink-0" aria-hidden="true" />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-label font-bold">{{ tile.label }}</span>
              {{ ' ' }}
              <span class="text-sm text-mute">{{ tile.example }}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
    <div class="flex justify-end px-5 pt-6 pb-5 lg:shrink-0">
      <button
        type="button"
        class="h-11 rounded-lg border-2 border-ink px-4 font-bold whitespace-nowrap"
        @click="$emit('cancel')"
      >
        Abbrechen
      </button>
    </div>
  </section>
</template>
