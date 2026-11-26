<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { useRoute } from 'vue-router'
import { SettingsIcon } from '@lucide/vue'

/**
 * The gear in the header with the pages of the administration of the system (Reka UI DropdownMenu, as the filter pop-ups are Reka UI
 * too). On one of its pages the gear is white like the active item of the navigation.
 */
const route = useRoute()
const items = [
  { label: 'Nutzer', to: { name: 'users' } },
  { label: 'Gruppen', to: { name: 'groups' } },
  { label: 'Merkmale', to: { name: 'attributes' } },
  { label: 'Polter', to: { name: 'pileData' } },
]
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      class="flex size-11 items-center justify-center rounded-lg"
      :class="items.some((item) => item.to.name === route.name) && 'bg-paper text-ink'"
      aria-label="Verwaltung"
      title="Verwaltung"
    >
      <SettingsIcon aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="4"
        :collision-padding="8"
        class="z-60 min-w-44 rounded-lg border-2 border-ink bg-paper p-1 text-base text-ink"
      >
        <DropdownMenuItem v-for="item in items" :key="item.label" as-child>
          <RouterLink
            :to="item.to"
            class="flex h-11 items-center rounded-md px-3 aria-[current=page]:font-bold data-highlighted:bg-well"
          >
            {{ item.label }}
          </RouterLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
