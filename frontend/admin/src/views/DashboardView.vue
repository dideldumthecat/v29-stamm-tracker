<script setup lang="ts">
import { ref } from 'vue'
import type { DashboardResponse } from '@v29/shared/contract'
import SawBladeIcon from '@v29/shared/SawBladeIcon.vue'

import { formatDateTime } from '@/activity'
import { ApiError, request } from '@/api/client'
import FigureInfo from '@/components/FigureInfo.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import StatusCard from '@/components/StatusCard.vue'
import { formatTotal } from '@/keyFigures'

/**
 * The start page: one card per section of the answer, in its order. It knows no section or figure by key, so a new work step
 * on the server appears here without a change. All numbers and texts come from the server, the page only formats them.
 */
const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref(0)
const dashboard = ref<DashboardResponse | null>(null)

async function load() {
  status.value = 'loading'
  try {
    dashboard.value = await request<DashboardResponse>('GET', 'admin/dashboard')
    status.value = 'ready'
  } catch (error) {
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
  }
}
void load()

// Only one formula is open at a time, across all sections
const openKey = ref<string | null>(null)
</script>

<template>
  <main class="page-column py-8">
    <h1 class="text-3xl font-bold">Dashboard</h1>
    <p v-if="dashboard?.last_sync_at" class="mt-2 text-mute">
      Letzter Sync: {{ formatDateTime(dashboard.last_sync_at) }}
    </p>

    <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
    <StatusCard v-else-if="status === 'loading'" title="Moment" role="status">
      <template #icon>
        <SawBladeIcon :size="96" :stroke-width="1.5" spinning class="text-ink" aria-hidden="true" />
      </template>
      <template #text>Kennzahlen werden zusammengesägt</template>
    </StatusCard>

    <section
      v-for="section in status === 'ready' ? dashboard!.sections : []"
      :key="section.key"
      class="mt-6 card p-4 sm:p-6"
      :aria-labelledby="`section-${section.key}`"
    >
      <h2 :id="`section-${section.key}`" class="text-lg font-bold">{{ section.label }}</h2>
      <dl class="mt-4 grid gap-y-6 sm:grid-cols-3">
        <div
          v-for="(figure, index) in section.figures"
          :key="figure.key"
          class="flex flex-col items-center px-2 text-center"
        >
          <!-- Short line above every cell but the first row: stacked that is every cell after the first, in three columns from the fourth on -->
          <span
            v-if="index > 0"
            aria-hidden="true"
            class="mb-6 block h-px w-[35%] bg-soft"
            :class="index < 3 && 'sm:hidden'"
          />
          <!-- The button hangs beside the label, so that the label text itself stays centred; 44 px target, the icon starts 4 px after the text -->
          <dt class="relative text-caption font-semibold text-mute">
            {{ figure.label }}
            <FigureInfo
              v-if="figure.value !== null"
              :open="openKey === `${section.key}/${figure.key}`"
              :label="figure.label"
              :formula="figure.formula"
              :inserted="figure.inserted"
              :result="`${formatTotal(figure)}${figure.unit ? ` ${figure.unit}` : ''}`"
              :note="figure.note"
              class="absolute top-1/2 left-full -ml-[9px] -translate-y-1/2"
              @update:open="
                (open: boolean) => (openKey = open ? `${section.key}/${figure.key}` : null)
              "
            />
          </dt>
          <dd class="mt-1 text-3xl font-bold tabular-nums">
            <span v-if="figure.value === null" role="img" aria-label="nicht berechenbar">–</span>
            <template v-else>
              {{ formatTotal(figure)
              }}<span v-if="figure.unit" class="ml-1 text-lg font-semibold text-mute">{{
                figure.unit
              }}</span>
            </template>
          </dd>
        </div>
      </dl>
    </section>
  </main>
</template>
