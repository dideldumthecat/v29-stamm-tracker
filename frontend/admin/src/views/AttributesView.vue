<script setup lang="ts">
import { CheckIcon, GripVerticalIcon, LockIcon, MousePointerClickIcon, PlusIcon } from '@lucide/vue'

import AttributePreviewField from '@/components/AttributePreviewField.vue'
import AttributeSettings from '@/components/AttributeSettings.vue'
import AttributeTypePicker from '@/components/AttributeTypePicker.vue'
import DiscardDialog from '@/components/DiscardDialog.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import StatusCard from '@/components/StatusCard.vue'
import {
  countAttributes,
  hidingCandidates,
  isInheritedOnly,
  NEW_ATTRIBUTE,
  tileOf,
} from '@/attributes'
import { useAttributeCard } from '@/useAttributeCard'
import { useAttributes } from '@/useAttributes'

/**
 * The page "Merkmale": the preview of the attributes of a view (drag to reorder, click to select) and the card beside it with the form of
 * the selected one or of a new one. The state and the actions are in `useAttributes`, the place of the card and the scrolling in
 * `useAttributeCard`.
 */
const attrs = useAttributes()
const {
  status,
  failure,
  attributes,
  load,
  query,
  isNew,
  visible,
  selected,
  selectView,
  setInactive,
  cancelNew,
  draft,
  newStep,
  errors,
  saving,
  saveFailed,
  pickType,
  changeType,
  backToForm,
  livePreview,
  save,
  resetDraft,
  orderFailed,
  savedText,
  announcement,
  items,
  reorder,
  moveBy,
  asking,
  discard,
  closeSelected,
} = attrs
const { cardTop, arrowY, select, startNew } = useAttributeCard(attrs)

const viewButton = 'flex h-11 items-center rounded-lg border-2 px-3 text-base'
</script>

<template>
  <main class="py-8">
    <div class="page-column">
      <PageHeader title="Merkmale">
        Merkmale legen fest, was in der App erfasst wird, in der Reihenfolge der Vorschau. Die
        Reihenfolge änderst du per Ziehen, sie wird sofort gespeichert. Änderungen kommen beim
        nächsten Synchronisieren auf die Handys. Merkmale mit
        <LockIcon :size="14" class="inline-block align-[-2px]" aria-label="Schloss" /> sind
        Systemmerkmale: App und Berichte rechnen mit ihnen, deshalb änderst du hier nur Name,
        Beschreibung und Reihenfolge, alles andere ist im Code festgelegt.
      </PageHeader>

      <div class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div class="flex flex-col text-sm text-mute">
          <span :id="'view-label'">Vorschau für</span>
          <div class="mt-1 flex gap-3" role="group" aria-labelledby="view-label">
            <button
              v-for="[view, label] in [
                ['stem', 'Stamm'],
                ['beam', 'Balken'],
              ] as const"
              :key="view"
              type="button"
              :class="[
                viewButton,
                query.view === view
                  ? 'border-ink bg-paper font-bold text-ink'
                  : 'border-dim bg-transparent text-ink',
              ]"
              :aria-pressed="query.view === view"
              @click="selectView(view)"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <label class="flex h-11 items-center gap-3 text-base">
          <input
            type="checkbox"
            class="size-5 accent-ink"
            :checked="query.inactive"
            @change="setInactive(($event.target as HTMLInputElement).checked)"
          />
          Inaktive zeigen
        </label>
      </div>
    </div>

    <ResultsBar
      v-if="status === 'ready'"
      class="mt-4"
      :text="countAttributes(visible.length)"
      :chips="[]"
      :can-reset="false"
    >
      <template #status>
        <!-- Stays until the next try (an alert is read out by itself); the confirmation goes away after 3 seconds -->
        <p v-if="orderFailed" class="text-base font-semibold" role="alert">
          Die Reihenfolge konnte nicht gespeichert werden. Sie ist wieder wie vorher.
        </p>
        <p
          v-else-if="savedText"
          class="flex items-center gap-1.5 text-base text-mute"
          aria-hidden="true"
        >
          <CheckIcon :size="18" />
          {{ savedText }}
        </p>
      </template>
    </ResultsBar>

    <div class="page-column">
      <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
      <LoadingStatus v-else-if="status === 'loading'" role="status" />

      <div v-else class="mt-2 grid items-start gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
        <div ref="left" class="relative w-full max-w-[440px] max-lg:mx-auto">
          <p class="sr-only" role="status">{{ announcement }}</p>
          <!-- Like the table of the lists: padding of 8 px, lines (soft) only between the fields, ending 8 px short of the card's edge -->
          <div class="card p-2">
            <ul
              v-if="visible.length || isNew"
              ref="list"
              aria-label="Vorschau"
              class="divide-y divide-soft"
            >
              <li
                v-for="(attribute, index) in visible"
                :key="attribute.id"
                :data-attribute="attribute.id"
                :style="reorder.style(index)"
              >
                <AttributePreviewField
                  :attribute="attribute"
                  :selected="attribute.id === selected?.id"
                  :inherited="isInheritedOnly(attribute, query.view)"
                  movable
                  @select="select(attribute)"
                  @drag="reorder.start($event, index, items)"
                  @move="moveBy(index, $event)"
                />
              </li>
              <!-- The new attribute: a placeholder until type and name are there, then the attribute itself -->
              <li v-if="livePreview">
                <AttributePreviewField :attribute="livePreview" selected />
              </li>
              <li v-else-if="isNew">
                <!-- Built like a field (the name above, an empty input area of 52 px below), selected like one: the same padding and the grip in the
                     same place, but not movable. The area is dashed grey, without text or symbol, so that it does not look like a button. -->
                <div class="relative bg-paper py-0.5">
                  <div
                    class="flex flex-col gap-2.5 rounded-md bg-well py-5 pr-11 pl-11 ring-2 ring-ink ring-inset"
                    aria-current="true"
                    data-placeholder
                  >
                    <span class="text-label leading-6 font-bold text-mute"
                      >Unbenanntes Merkmal</span
                    >
                    <span
                      class="h-[52px] rounded-lg border-2 border-dashed border-lockline"
                      aria-hidden="true"
                    ></span>
                  </div>
                  <span
                    class="absolute top-1/2 left-0.5 flex size-10 -translate-y-1/2 items-center justify-center text-[#888] opacity-40 supports-[top:round(50%,1px)]:top-[round(50%,1px)]"
                    aria-hidden="true"
                  >
                    <GripVerticalIcon :size="22" />
                  </span>
                </div>
              </li>
            </ul>
            <p v-else class="p-5 text-mute">In dieser Ansicht gibt es keine Merkmale.</p>
          </div>
          <!-- Gone while a draft is open (the placeholder or the new field is in the card then, and the space below it goes too); below the card on the grey page, as wide as the card and as high as the big buttons of the preview (min-h-row, text-label, like "Foto aufnehmen") -->
          <button
            v-if="!isNew"
            type="button"
            class="mt-4 flex min-h-row w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-lockline text-label font-bold text-dim enabled:text-ink"
            @click="startNew"
          >
            <PlusIcon :size="22" :stroke-width="2.5" aria-hidden="true" />
            Merkmal hinzufügen
          </button>
        </div>

        <!-- As high as its content; from lg on it starts at the height of the selected field (`cardTop`), the arrow points at it -->
        <div
          ref="right"
          data-settings-column
          class="relative lg:mt-(--card-top)"
          :style="{ '--card-top': `${cardTop}px` }"
        >
          <AttributeTypePicker
            v-if="(isNew || selected) && newStep === 'type'"
            :title="isNew ? undefined : 'Typ ändern'"
            :current="draft ? tileOf(draft.type) : undefined"
            @pick="pickType"
            @cancel="isNew ? cancelNew() : backToForm()"
          />
          <AttributeSettings
            v-else-if="selected && draft"
            ref="settings"
            v-model="draft"
            :attribute="selected"
            :candidates="hidingCandidates(attributes, selected.id)"
            :errors="errors"
            :saving="saving"
            :failed="saveFailed"
            @save="save"
            @reset="resetDraft"
            @close="closeSelected"
            @change-type="changeType"
          />
          <AttributeSettings
            v-else-if="isNew && draft"
            ref="settings"
            v-model="draft"
            :attribute="null"
            :candidates="hidingCandidates(attributes, NEW_ATTRIBUTE)"
            :errors="errors"
            :saving="saving"
            :failed="saveFailed"
            @save="save"
            @cancel="cancelNew"
            @change-type="changeType"
          />
          <!-- The same display as "Waldesruh" in the lists, in the place of the settings (the column keeps its width and its place at the top) -->
          <StatusCard
            v-else
            title="Nichts ausgewählt"
            text-class="md:whitespace-nowrap"
            role="status"
          >
            <template #icon>
              <MousePointerClickIcon
                :size="96"
                :stroke-width="1.5"
                class="text-ink"
                aria-hidden="true"
              />
            </template>
            <template #text>Merkmal zum Bearbeiten auswählen oder ein neues anlegen.</template>
            <!-- The same as the button under the preview, in the style of the other outlined buttons (like "Verwerfen"), as wide as its content -->
            <button
              type="button"
              class="mt-2 flex h-11 items-center gap-2 rounded-lg border-2 border-ink px-4 font-bold whitespace-nowrap"
              @click="startNew"
            >
              <PlusIcon :size="18" aria-hidden="true" />
              Merkmal hinzufügen
            </button>
          </StatusCard>
          <!-- A square turned by 45° whose left and lower edge are the card's frame; the other half lies on the card and hides its frame there -->
          <span
            v-if="arrowY !== null && (isNew || selected)"
            data-card-arrow
            class="absolute -left-[7px] hidden size-3.5 rotate-45 border-b border-l border-line bg-paper lg:block"
            :style="{ top: `${arrowY - 7}px` }"
            aria-hidden="true"
          ></span>
        </div>
      </div>
    </div>

    <DiscardDialog v-model:open="asking" @discard="discard" />
  </main>
</template>
