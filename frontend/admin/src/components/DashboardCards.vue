<script setup lang="ts">
import type { DashboardCard, DashboardCardsSection } from '@v29/shared/contract'

import FigureInfo from '@/components/FigureInfo.vue'
import { numberParts } from '@/keyFigures'

/**
 * A section of cards on the dashboard ("Rundholz", "Schnittholz"): heading, description and the cards in a grid (four columns on wide
 * screens, two from sm, one on phones). Every text comes formatted from the server; the section is drawn without knowing a key.
 */
defineProps<{ section: DashboardCardsSection }>()
/** Which info button is open, across all sections ("section/card"); the page holds it */
const openKey = defineModel<string | null>('openKey', { required: true })

const NOT_CALCULABLE = '–'
const result = (card: DashboardCard) => `${card.value}${card.unit ? ` ${card.unit}` : ''}`
</script>

<template>
  <section :aria-labelledby="`section-${section.key}`">
    <div class="flex flex-col gap-0.5">
      <h2 :id="`section-${section.key}`" class="text-label font-bold">{{ section.label }}</h2>
      <p v-if="section.description" class="text-caption text-mute">{{ section.description }}</p>
    </div>
    <dl class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="card in section.cards"
        :key="card.key"
        class="flex min-w-0 flex-col gap-2.5 card px-5 py-[18px]"
        :class="[
          card.starts_row && 'sm:col-start-1',
          card.highlight && 'border-accent inset-ring inset-ring-accent',
        ]"
      >
        <dt
          class="flex items-center gap-1.5 text-caption"
          :class="card.highlight ? 'font-bold text-accent' : 'font-medium text-mute'"
        >
          <span
            v-if="card.marker"
            aria-hidden="true"
            class="size-2.5 shrink-0"
            :class="card.marker === 'large' ? 'bg-beam-large' : 'bg-beam-small'"
          />
          <!-- The button hangs beside the label (44 px target), so that the row does not grow; the icon starts 4 px after the text -->
          <span class="relative">
            {{ card.label }}
            <FigureInfo
              :open="openKey === `${section.key}/${card.key}`"
              :label="card.label"
              :formula="card.formula"
              :inserted="card.inserted"
              :result="result(card)"
              :note="card.note"
              class="absolute top-1/2 left-full -ml-[9px] -translate-y-1/2"
              @update:open="
                (open: boolean) => (openKey = open ? `${section.key}/${card.key}` : null)
              "
            />
          </span>
        </dt>
        <dd class="text-[40px] leading-none font-bold tabular-nums">
          <span v-if="card.value === NOT_CALCULABLE" role="img" aria-label="nicht berechenbar">{{
            NOT_CALCULABLE
          }}</span>
          <template v-else>{{ card.value }}</template>
          <span v-if="card.unit" class="text-base font-medium">&nbsp;{{ card.unit }}</span>
        </dd>
        <!-- Numbers bold and large, the words between them small, as in the design -->
        <dd v-if="card.secondary" class="text-xl leading-none font-bold tabular-nums">
          <template v-for="(part, index) in numberParts(card.secondary)" :key="index">
            <span v-if="part.number">{{ part.text }}</span>
            <span v-else class="text-sm font-medium">{{ part.text }}</span>
          </template>
        </dd>
      </div>
    </dl>
  </section>
</template>
