<script setup lang="ts">
import { ref } from 'vue'
import type { PileCardSection, PileCardsResponse } from '@/api/contract'

import { ApiError, request } from '@/api/client'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import PageHeader from '@/components/PageHeader.vue'
import PileCard from '@/components/PileCard.vue'

/** The page "Polter": one card per pile, in the order of the server (the newest pile first). The page only draws what the server calculated. */
const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref(0)
const sections = ref<PileCardSection[]>([])

async function load() {
  status.value = 'loading'
  try {
    sections.value = (await request<PileCardsResponse>('GET', 'admin/pile-cards')).sections
    status.value = 'ready'
  } catch (error) {
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
  }
}
void load()
</script>

<template>
  <main class="page-column py-8">
    <PageHeader title="Polter">Zuletzt angelegter Polter oben.</PageHeader>

    <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
    <LoadingStatus v-else-if="status === 'loading'" role="status" />

    <div v-else class="flex flex-col gap-6">
      <PileCard v-for="section in sections" :key="section.key" :section="section" />
    </div>
  </main>
</template>
