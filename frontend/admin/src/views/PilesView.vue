<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import type { AdminPile, AdminPilesResponse } from '@v29/shared/contract'
import { PlusIcon } from '@lucide/vue'

import { ApiError, request } from '@/api/client'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import PileForm from '@/components/PileForm.vue'
import PileTable from '@/components/PileTable.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import { countPiles, draftOf, emptyDraft, fieldsOf, pileErrorsOf, type PileDraft } from '@/piles'

/**
 * The page "Polter": the master data of the piles from the handover record of the forestry office, built like the page "Nutzer": a table, one
 * pile at a time opens in a card below its row, the button above the table adds one. The label the app shows is derived by the server on every
 * save. Piles are never deleted and not deactivated here.
 */
const id = useId()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref(0)
const piles = ref<AdminPile[]>([])

async function load() {
  status.value = 'loading'
  try {
    piles.value = (await request<AdminPilesResponse>('GET', 'admin/piles')).piles
    status.value = 'ready'
  } catch (error) {
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
  }
}
void load()

// One request at a time; the outcome is said in a line next to the count (read out too).
const busy = ref(false)
const notice = ref<{ text: string; error: boolean } | null>(null)
async function attempt(
  run: () => Promise<void>,
  onInvalid?: (errors: Record<string, string>) => void,
) {
  if (busy.value) return
  busy.value = true
  notice.value = null
  try {
    await run()
  } catch (error) {
    if (error instanceof ApiError && error.status === 422 && onInvalid) {
      onInvalid(pileErrorsOf(error.body))
    } else {
      notice.value = {
        text:
          error instanceof ApiError && error.status === 0
            ? 'Keine Verbindung zum Server. Bitte noch einmal versuchen.'
            : 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
        error: true,
      }
    }
  } finally {
    busy.value = false
  }
}
const say = (text: string) => (notice.value = { text, error: false })
const replace = (pile: AdminPile) =>
  (piles.value = piles.value.map((entry) => (entry.id === pile.id ? pile : entry)))

// --- The open pile ---------------------------------------------------------------------------------------------------------------

const openId = ref<string | null>(null)
const openPile = computed(() => piles.value.find((pile) => pile.id === openId.value) ?? null)
// The table splits below the open row: the card of the pile hangs in between.
const split = computed(() => {
  const index = piles.value.findIndex((pile) => pile.id === openId.value)
  return index < 0
    ? { before: piles.value, after: [] }
    : { before: piles.value.slice(0, index + 1), after: piles.value.slice(index + 1) }
})

// What is typed in the card; thrown away with every other pile opened.
const draft = ref<PileDraft>(emptyDraft())
const saveErrors = ref<Record<string, string>>({})
const changed = computed(
  () => !!openPile.value && JSON.stringify(draft.value) !== JSON.stringify(draftOf(openPile.value)),
)

function toggle(pile: AdminPile) {
  if (openId.value === pile.id) {
    openId.value = null
    return
  }
  openId.value = pile.id
  draft.value = draftOf(pile)
  saveErrors.value = {}
}

const save = () => {
  const read = fieldsOf(draft.value)
  if ('errors' in read) {
    saveErrors.value = read.errors
    return
  }
  return attempt(
    async () => {
      saveErrors.value = {}
      const answer = await request<AdminPile>('PATCH', `admin/piles/${openId.value}`, read.fields)
      replace(answer)
      openId.value = null
      say(`${answer.label} ist gespeichert.`)
    },
    (errors) => (saveErrors.value = errors),
  )
}

// --- Add -------------------------------------------------------------------------------------------------------------------------

const adding = ref(false)
const newDraft = ref<PileDraft>(emptyDraft())
const createErrors = ref<Record<string, string>>({})
const addButton = useTemplateRef<HTMLButtonElement>('addButton')
const addCard = useTemplateRef<HTMLElement>('addCard')
const arrowRight = ref(32)

// The arrow of the card points at the middle of the real button, see the page of the users.
function placeArrow() {
  if (!addButton.value || !addCard.value) return
  const button = addButton.value.getBoundingClientRect()
  const card = addCard.value.getBoundingClientRect()
  if (!button.width) return
  arrowRight.value = Math.round(card.right - (button.left + button.width / 2) - 7 - 1)
}
onMounted(() => window.addEventListener('resize', placeArrow))
onBeforeUnmount(() => window.removeEventListener('resize', placeArrow))

async function toggleAdd() {
  adding.value = !adding.value
  if (!adding.value) return
  createErrors.value = {}
  await nextTick()
  placeArrow()
  addCard.value?.querySelector('input')?.focus()
}

const create = () => {
  const read = fieldsOf(newDraft.value)
  if ('errors' in read) {
    createErrors.value = read.errors
    return
  }
  return attempt(
    async () => {
      createErrors.value = {}
      const answer = await request<AdminPile>('POST', 'admin/piles', read.fields)
      piles.value = [...piles.value, answer]
      adding.value = false
      newDraft.value = emptyDraft()
      say(`${answer.label} ist angelegt.`)
    },
    (errors) => (createErrors.value = errors),
  )
}

const button =
  'flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 font-bold whitespace-nowrap'
</script>

<template>
  <main class="py-8">
    <div class="page-column">
      <h1 class="text-3xl font-bold">Polter</h1>
      <p class="mt-2 text-measure text-mute">
        Die Polter, aus denen die Stämme kommen. In der App wählt man den Polter beim Erfassen eines
        Stamms aus.
      </p>

      <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
      <LoadingStatus v-else-if="status === 'loading'" role="status" />
    </div>

    <ResultsBar
      v-if="status === 'ready'"
      class="mt-4"
      :text="countPiles(piles.length)"
      :chips="[]"
      :can-reset="false"
    >
      <template #status>
        <p
          v-if="notice"
          class="text-base"
          :class="notice.error ? 'font-semibold' : 'text-mute'"
          :role="notice.error ? 'alert' : 'status'"
        >
          {{ notice.text }}
        </p>
      </template>
      <template #end>
        <button
          ref="addButton"
          type="button"
          :class="[
            button,
            'border-ink',
            adding ? 'border-solid bg-paper' : 'border-dashed bg-transparent',
          ]"
          :aria-expanded="adding"
          :aria-controls="`${id}-add`"
          @click="toggleAdd"
        >
          <PlusIcon :size="20" aria-hidden="true" />
          Polter hinzufügen
        </button>
      </template>
    </ResultsBar>

    <div v-if="status === 'ready'" class="page-column">
      <section
        v-if="adding"
        :id="`${id}-add`"
        ref="addCard"
        class="relative mt-2 card p-5 sm:px-6"
        :aria-labelledby="`${id}-add-title`"
      >
        <span
          class="absolute -top-2 size-3.5 rotate-45 border-t border-l border-line bg-paper"
          :style="{ right: `${arrowRight}px` }"
          aria-hidden="true"
        />
        <h2 :id="`${id}-add-title`" class="text-label font-bold">Polter hinzufügen</h2>
        <PileForm
          v-model="newDraft"
          class="mt-4"
          :errors="createErrors"
          :disabled="busy"
          @submit="create"
          @cancel="toggleAdd"
        />
      </section>

      <div :class="adding ? 'mt-4' : 'mt-2'">
        <PileTable
          :piles="split.before"
          head
          :square="openPile ? 'bottom' : undefined"
          :open-id="openId"
          :controls="`${id}-panel`"
          @toggle="toggle"
        />

        <section
          v-if="openPile"
          :id="`${id}-panel`"
          class="relative my-4 card px-5 pt-[38px] pb-5 sm:px-6"
          :aria-label="`Polter ${openPile.label} bearbeiten`"
        >
          <span
            class="absolute -top-2 left-[26px] size-3.5 rotate-45 border-t border-l border-line bg-paper"
            aria-hidden="true"
          />
          <PileForm
            v-model="draft"
            map
            :errors="saveErrors"
            :disabled="!changed || busy"
            @submit="save"
            @cancel="openId = null"
          />
        </section>

        <PileTable
          v-if="split.after.length"
          :piles="split.after"
          :head="false"
          square="top"
          :open-id="openId"
          :controls="`${id}-panel`"
          @toggle="toggle"
        />
      </div>
    </div>
  </main>
</template>
