<script setup lang="ts">
import { ref } from 'vue'
import { RefreshCwIcon } from '@lucide/vue'
import type { DashboardResponse } from '@/api/contract'

import { formatDateTime } from '@/activity'
import { ApiError, request } from '@/api/client'
import DashboardCards from '@/components/DashboardCards.vue'
import DiameterClasses from '@/components/DiameterClasses.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import PageHeader from '@/components/PageHeader.vue'

/**
 * The start page: the sections of the answer in their order, drawn by the type of the section. It knows no section or card
 * by key, so a new work step on the server appears here without a change. All numbers and texts come from the server; only the
 * table of diameter classes formats and sorts its raw numbers.
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
    <PageHeader title="Dashboard">
      <template #aside>
        <p v-if="dashboard?.last_sync_at" class="whitespace-nowrap text-mute">
          <RefreshCwIcon
            :size="16"
            class="-mt-0.5 mr-1.5 inline-block align-middle"
            aria-hidden="true"
          />Letzter Sync: {{ formatDateTime(dashboard.last_sync_at) }}
        </p>
      </template>
    </PageHeader>

    <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
    <LoadingStatus v-else-if="status === 'loading'" role="status" />

    <template
      v-for="(section, index) in status === 'ready' ? dashboard!.sections : []"
      :key="section.key"
    >
      <!-- Below another section the next one starts with more room, as in the design; the first one follows the page header -->
      <DiameterClasses
        v-if="section.type === 'diameter_classes'"
        :section="section"
        :class="{ 'mt-10': index > 0 }"
      />
      <DashboardCards
        v-else
        v-model:open-key="openKey"
        :section="section"
        :class="{ 'mt-10': index > 0 }"
      />
    </template>
  </main>
</template>
