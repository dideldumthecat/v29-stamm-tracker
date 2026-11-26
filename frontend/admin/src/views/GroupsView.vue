<script setup lang="ts">
import { ref, useId, useTemplateRef } from 'vue'
import { PlusIcon } from '@lucide/vue'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import GroupCard from '@/components/GroupCard.vue'
import GroupTable from '@/components/GroupTable.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import { useAddCard } from '@/useAddCard'
import { useGroups } from '@/useGroups'

/**
 * The page "Gruppen": which attributes the members of a group see in the app. Built like the page "Nutzer": a table, one group at a time opens
 * in a card below its row, the button above the table adds one (name only). The state and the actions are in `useGroups`.
 */
const id = useId()
const {
  status,
  failure,
  groups,
  attributes,
  busy,
  notice,
  load,
  openId,
  openGroup,
  split,
  draft,
  saveErrors,
  changed,
  toggle,
  save,
  remove,
  adding,
  newName,
  createErrors,
  toggleAdd,
  create,
} = useGroups()
const { addCard, arrowRight, placeArrow } = useAddCard()
const nameField = useTemplateRef<HTMLInputElement>('nameField')
const deleteOpen = ref(false)

const onOpenAdd = () => {
  placeArrow()
  nameField.value?.focus()
}

const button =
  'flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 font-bold whitespace-nowrap'
</script>

<template>
  <main class="py-8">
    <div class="page-column">
      <PageHeader title="Gruppen">
        Welche Merkmale die Mitglieder einer Gruppe in der App sehen. Jeder Nutzer gehört zu genau
        einer Gruppe. Die Administration zeigt immer alle Merkmale.
      </PageHeader>

      <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
      <LoadingStatus v-else-if="status === 'loading'" role="status" />
    </div>

    <ResultsBar
      v-if="status === 'ready'"
      :text="`${groups.length} ${groups.length === 1 ? 'Gruppe' : 'Gruppen'}`"
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
          @click="toggleAdd(onOpenAdd)"
        >
          <PlusIcon :size="20" aria-hidden="true" />
          Gruppe hinzufügen
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
          data-add-arrow
          aria-hidden="true"
        />
        <h2 :id="`${id}-add-title`" class="text-label font-bold">Gruppe hinzufügen</h2>
        <form @submit.prevent="create(() => nameField?.focus())">
          <div class="mt-4 min-w-60 sm:max-w-[420px]">
            <label :for="`${id}-name`" class="text-caption font-semibold text-mute">Name</label>
            <input
              :id="`${id}-name`"
              ref="nameField"
              v-model="newName"
              type="text"
              autocomplete="off"
              class="mt-1 h-11 w-full rounded-lg border-2 border-ink bg-paper px-3 text-base text-ink aria-invalid:bg-well"
              :aria-invalid="!!createErrors.name"
              :aria-describedby="createErrors.name ? `${id}-name-error` : undefined"
            />
            <p
              v-if="createErrors.name"
              :id="`${id}-name-error`"
              class="mt-1 text-sm font-semibold"
              role="alert"
            >
              {{ createErrors.name }}
            </p>
            <p class="mt-1 text-caption text-mute">
              Zuerst sieht die Gruppe kein Merkmal; welche, legst du danach fest.
            </p>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" :class="[button, 'border-ink']" @click="toggleAdd(onOpenAdd)">
              Abbrechen
            </button>
            <button
              type="submit"
              :class="[button, 'border-ink bg-ink text-paper']"
              :disabled="busy"
            >
              Anlegen
            </button>
          </div>
        </form>
      </section>

      <div :class="adding ? 'mt-4' : 'mt-2'">
        <GroupTable
          :groups="split.before"
          :total="attributes.length"
          head
          :square="openGroup ? 'bottom' : undefined"
          :open-id="openId"
          :controls="`${id}-panel`"
          @toggle="toggle"
        />

        <section
          v-if="openGroup"
          :id="`${id}-panel`"
          class="relative my-4 card px-5 pt-[38px] pb-5 sm:px-6"
          :aria-label="`Einstellungen der Gruppe ${openGroup.name}`"
        >
          <span
            class="absolute -top-2 left-[26px] size-3.5 rotate-45 border-t border-l border-line bg-paper"
            data-card-arrow
            aria-hidden="true"
          />
          <GroupCard
            v-model:draft="draft"
            :group="openGroup"
            :attributes="attributes"
            :errors="saveErrors"
            :changed="changed"
            :busy="busy"
            @save="save"
            @cancel="openId = null"
            @remove="deleteOpen = true"
          />
        </section>

        <GroupTable
          v-if="split.after.length"
          :groups="split.after"
          :total="attributes.length"
          :head="false"
          square="top"
          :open-id="openId"
          :controls="`${id}-panel`"
          @toggle="toggle"
        />
      </div>
    </div>

    <ConfirmDialog
      v-model:open="deleteOpen"
      danger
      :title="`Gruppe ${openGroup?.name} löschen?`"
      confirm="Gruppe löschen"
      cancel="Abbrechen"
      @confirm="remove(openGroup!)"
    >
      {{ openGroup?.name }} wird gelöscht, samt der Auswahl der Merkmale. Das lässt sich nicht
      rückgängig machen.
    </ConfirmDialog>
  </main>
</template>
