<script setup lang="ts">
import type { AdminGroup } from '@/api/contract'
import { ChevronDownIcon, ChevronRightIcon } from '@lucide/vue'

import { attributesText } from '@/groups'

/**
 * The groups as a white card with a table, built like the table of the users: with one open, the page shows two of these and the card of
 * the open group in between (`square` takes the round corners off the edge that faces it), both with the same column widths.
 */
defineProps<{
  groups: AdminGroup[]
  /** How many attributes there are: "12 von 14". */
  total: number
  /** Only the first of the two tables has the head. */
  head: boolean
  square?: 'top' | 'bottom'
  openId: string | null
  controls: string
}>()
defineEmits<{ toggle: [group: AdminGroup] }>()
</script>

<template>
  <div
    class="card p-2"
    :class="[square === 'bottom' && 'rounded-b-none', square === 'top' && 'rounded-t-none']"
  >
    <table
      class="w-full table-fixed border-separate border-spacing-0 text-base"
      :aria-label="head ? 'Gruppen' : 'Weitere Gruppen'"
    >
      <colgroup>
        <col />
        <col class="w-36 sm:w-56" />
        <col class="hidden w-72 md:table-column" />
      </colgroup>
      <thead v-if="head">
        <tr class="text-left text-caption leading-5 font-semibold text-mute">
          <th scope="col" class="border-b-2 border-ink pt-8 pr-3 pb-2 pl-11 align-bottom">Name</th>
          <th scope="col" class="border-b-2 border-ink px-3 pt-8 pb-2 align-bottom">
            Merkmale in der App
          </th>
          <th
            scope="col"
            class="hidden border-b-2 border-ink px-3 pt-8 pb-2 align-bottom md:table-cell"
          >
            Nutzer
          </th>
        </tr>
      </thead>
      <tbody class="[&_tr:not(:last-child)>td]:border-b [&_tr:not(:last-child)>td]:border-soft">
        <tr
          v-for="group in groups"
          :key="group.id"
          :data-group="group.name"
          class="relative hover:bg-well"
        >
          <td class="h-16 py-2 pr-3 pl-4 align-middle">
            <!-- The one button of the row (chevron and name); its pseudo-element covers the whole row, as in the table of the users. -->
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left after:absolute after:inset-0"
              :aria-expanded="openId === group.id"
              :aria-controls="openId === group.id ? controls : undefined"
              @click="$emit('toggle', group)"
            >
              <component
                :is="openId === group.id ? ChevronDownIcon : ChevronRightIcon"
                :size="20"
                class="shrink-0"
                data-chevron
                aria-hidden="true"
              />
              <span class="font-bold wrap-anywhere">{{ group.name }}</span>
            </button>
          </td>
          <td class="px-3 py-2 align-middle">{{ attributesText(group, total) }}</td>
          <td class="hidden px-3 py-2 align-middle wrap-anywhere md:table-cell">
            {{ group.users.map((user) => user.name).join(', ') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
