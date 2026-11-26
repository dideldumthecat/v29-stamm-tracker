<script setup lang="ts">
import type { AdminUser } from '@/api/contract'
import { ChevronDownIcon, ChevronRightIcon } from '@lucide/vue'

import { formatDate } from '@/activity'
import { isBlocked, lastActiveText, ROLE_LABELS } from '@/users'

/**
 * The users as a white card with a table. With a user opened the page shows two of these (the rows up to the open one, the rest) and
 * the open user's own card in between: `square` takes the round corners off the edge that faces that card. Both tables share
 * the column widths (`table-fixed`), so they read as one table. Which user is open, and what is in the card, is the page's business.
 */
defineProps<{
  users: AdminUser[]
  /** Only the first of the two tables has the head. */
  head: boolean
  square?: 'top' | 'bottom'
  openId: string | null
  controls: string
}>()
defineEmits<{ toggle: [user: AdminUser] }>()
</script>

<template>
  <div
    class="card p-2"
    :class="[square === 'bottom' && 'rounded-b-none', square === 'top' && 'rounded-t-none']"
  >
    <table
      class="w-full table-fixed border-separate border-spacing-0 text-base"
      :aria-label="head ? 'Nutzer' : 'Weitere Nutzer'"
    >
      <colgroup>
        <col />
        <col class="w-28 sm:w-32" />
        <col class="hidden w-36 sm:table-column" />
        <col class="hidden w-32 md:table-column" />
      </colgroup>
      <!-- The head is as high as a two-line head of the stem list: the space above the words is what makes it so. -->
      <thead v-if="head">
        <tr class="text-left text-caption leading-5 font-semibold text-mute">
          <th scope="col" class="border-b-2 border-ink pt-8 pr-3 pb-2 pl-11 align-bottom">Name</th>
          <th scope="col" class="border-b-2 border-ink px-3 pt-8 pb-2 align-bottom">Rolle</th>
          <th
            scope="col"
            class="hidden border-b-2 border-ink px-3 pt-8 pb-2 align-bottom sm:table-cell"
          >
            Letzter Sync
          </th>
          <th
            scope="col"
            class="hidden border-b-2 border-ink px-3 pt-8 pb-2 align-bottom md:table-cell"
          >
            Angelegt
          </th>
        </tr>
      </thead>
      <tbody class="[&_tr:not(:last-child)>td]:border-b [&_tr:not(:last-child)>td]:border-soft">
        <tr
          v-for="user in users"
          :key="user.id"
          :data-user="user.name"
          class="relative"
          :class="[user.can_manage && 'hover:bg-well', isBlocked(user) && 'text-mute']"
        >
          <td class="h-16 py-2 pr-3 pl-4 align-middle">
            <!-- The one button of the row (chevron and name) opens and closes; its pseudo-element covers the whole row (the row is `relative`),
                 so a click anywhere in it counts, and the keyboard and screen readers still meet one control. Whoever cannot be changed has no
                 button, no hover and no pointer: the name stays where it is. -->
            <button
              v-if="user.can_manage"
              type="button"
              class="flex w-full items-center gap-2 text-left after:absolute after:inset-0"
              :aria-expanded="openId === user.id"
              :aria-controls="openId === user.id ? controls : undefined"
              @click="$emit('toggle', user)"
            >
              <component
                :is="openId === user.id ? ChevronDownIcon : ChevronRightIcon"
                :size="20"
                class="shrink-0"
                data-chevron
                aria-hidden="true"
              />
              <span class="font-bold wrap-anywhere">{{ user.name }}</span>
              <span
                v-if="isBlocked(user)"
                class="shrink-0 rounded-full border border-lockline px-2 text-caption leading-5"
              >
                Gesperrt
              </span>
            </button>
            <div v-else class="flex items-center gap-2">
              <span class="size-5 shrink-0" aria-hidden="true" />
              <span class="font-bold wrap-anywhere">{{ user.name }}</span>
              <span
                v-if="isBlocked(user)"
                class="shrink-0 rounded-full border border-lockline px-2 text-caption leading-5"
              >
                Gesperrt
              </span>
            </div>
          </td>
          <td class="px-3 py-2 align-middle">{{ ROLE_LABELS[user.role] }}</td>
          <td class="hidden px-3 py-2 align-middle sm:table-cell">{{ lastActiveText(user) }}</td>
          <td class="hidden px-3 py-2 align-middle md:table-cell">
            {{ formatDate(user.created_at) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
