<script setup lang="ts">
import type { AdminPile } from '@/api/contract'
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon } from '@lucide/vue'

import { formatVolume, mapUrl } from '@/piles'

/**
 * The piles as a white card with a table, built like the table of the users: with one open, the page shows two of these and the card of
 * the open pile in between (`square` takes the round corners off the edge that faces it), both with the same column widths.
 */
defineProps<{
  piles: AdminPile[]
  /** Only the first of the two tables has the head. */
  head: boolean
  square?: 'top' | 'bottom'
  openId: string | null
  controls: string
}>()
defineEmits<{ toggle: [pile: AdminPile] }>()
</script>

<template>
  <div
    class="card p-2"
    :class="[square === 'bottom' && 'rounded-b-none', square === 'top' && 'rounded-t-none']"
  >
    <table
      class="w-full table-fixed border-separate border-spacing-0 text-base"
      :aria-label="head ? 'Polter' : 'Weitere Polter'"
    >
      <colgroup>
        <col />
        <col class="w-36" />
        <col class="hidden w-64 sm:table-column" />
      </colgroup>
      <thead v-if="head">
        <tr class="text-left text-caption leading-5 font-semibold text-mute">
          <th scope="col" class="border-b-2 border-ink pt-8 pr-3 pb-2 pl-11 align-bottom">
            Polter
          </th>
          <th scope="col" class="border-b-2 border-ink px-3 pt-8 pb-2 text-right align-bottom">
            Raummeter
          </th>
          <th
            scope="col"
            class="hidden border-b-2 border-ink px-3 pt-8 pb-2 align-bottom sm:table-cell"
          >
            Lage
          </th>
        </tr>
      </thead>
      <tbody class="[&_tr:not(:last-child)>td]:border-b [&_tr:not(:last-child)>td]:border-soft">
        <tr
          v-for="pile in piles"
          :key="pile.id"
          :data-pile="pile.label"
          class="relative hover:bg-well"
        >
          <td class="h-16 py-2 pr-3 pl-4 align-middle">
            <!-- One button per row (chevron and label) opens and closes; its pseudo-element covers the row, like the table of the users. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left after:absolute after:inset-0"
              :aria-expanded="openId === pile.id"
              :aria-controls="openId === pile.id ? controls : undefined"
              @click="$emit('toggle', pile)"
            >
              <component
                :is="openId === pile.id ? ChevronDownIcon : ChevronRightIcon"
                :size="20"
                class="shrink-0"
                data-chevron
                aria-hidden="true"
              />
              <span class="font-bold wrap-anywhere">{{ pile.label }}</span>
            </button>
          </td>
          <td class="px-3 py-2 text-right align-middle tabular-nums">
            {{ pile.stacked_volume === null ? '–' : formatVolume(pile.stacked_volume) }}
          </td>
          <td class="hidden px-3 py-2 align-middle sm:table-cell">
            <!-- Above the pseudo-element of the row button, so the link takes its own click -->
            <a
              v-if="mapUrl(pile)"
              :href="mapUrl(pile)!"
              target="_blank"
              rel="noopener"
              class="relative z-10 inline-flex items-center gap-1.5 underline"
            >
              In OpenStreetMap öffnen
              <ExternalLinkIcon :size="16" aria-hidden="true" />
            </a>
            <span v-else class="text-mute">–</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
