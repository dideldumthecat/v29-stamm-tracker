<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId } from 'vue'
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@lucide/vue'
import type { AdminAttribute, AttributeType, ItemKind } from '@v29/shared/contract'

import CheckboxRow from '@/components/CheckboxRow.vue'
import SettingsRow from '@/components/SettingsRow.vue'
import StemBeamSection from '@/components/StemBeamSection.vue'
import {
  isChanged,
  KIND_LABELS,
  moveItem,
  newRowId,
  SERIES_TYPES,
  stemBeamText,
  tileOf,
  TILES,
  TYPE_LABELS,
  withType,
  type AttributeDraft,
} from '@/attributes'
import { useReorder } from '@/reorder'

/**
 * The settings of the selected attribute. An attribute with a key (system attribute) only shows its values as text: it is maintained in the
 * code. Any other has the form: the draft is the parent's (`v-model`), saving and the errors of a 422 as well. What has values can no longer
 * change in type, inheritance and series (the server refuses it too).
 * The type on top is text with "ändern" (to the tiles, the parent shows them); for a date the row "Genauigkeit" (day or month).
 * Without an `attribute` the form is the second step of a new one: "Abbrechen" and "Anlegen" at the bottom.
 * The card is as high as its content and scrolls with the page; the buttons are its last row (without a line above), nothing sticks.
 */
const props = defineProps<{
  /** null: the draft of a new attribute */
  attribute: AdminAttribute | null
  /** The yes/no system attributes the attribute can be hidden by. */
  candidates: AdminAttribute[]
  /** field → message of a 422 */
  errors: Record<string, string>
  saving: boolean
  /** Saving failed for a reason other than a rule (no connection, server error). */
  failed: boolean
}>()
const draft = defineModel<AttributeDraft>({ required: true })
const emit = defineEmits<{ save: []; reset: []; cancel: []; close: []; changeType: [] }>()

const id = useId()

// After a 422: the first field with a message, in the order of the form (not of the server's list), is scrolled into view and focused.
// The rows with a message (SettingsRow) and the inputs of an option carry `data-error`.
const form = ref<HTMLFormElement>()
async function focusFirstError() {
  await nextTick()
  const marked = form.value?.querySelector<HTMLElement>('[data-error]')
  const control = marked?.matches('input, select, textarea')
    ? marked
    : marked?.querySelector<HTMLElement>(
        'input:not(:disabled), select, textarea, button:not(:disabled)',
      )
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ;(control ?? marked)?.scrollIntoView?.({
    block: 'nearest',
    behavior: reduced ? 'auto' : 'smooth',
  })
  control?.focus({ preventScroll: true })
}
// After a successful save "Speichern" is disabled, which would drop the focus onto the page: the heading takes it (the parent asks for it)
const heading = ref<HTMLElement>()
const focusHeading = () => heading.value?.focus()
defineExpose({ focusFirstError, focusHeading })
const isNew = computed(() => !props.attribute)
const changed = computed(() => !!props.attribute && isChanged(props.attribute, draft.value))
const locked = computed(() => props.attribute?.has_values ?? false)
const tileLabel = computed(
  () =>
    TILES.find((tile) => tile.type === tileOf(draft.value.type))?.label ??
    TYPE_LABELS[draft.value.type],
)
const seriesPossible = computed(() => SERIES_TYPES.includes(draft.value.type))

const set = <K extends keyof AttributeDraft>(key: K, value: AttributeDraft[K]) =>
  (draft.value = { ...draft.value, [key]: value })
const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]

// "Gültig für". Inheritance only means something for what is valid for the stem: a new attribute without "Stamm" is not inheritable. The saved
// value of an existing one is left as it is (its row is only hidden then).
function toggleKind(kind: ItemKind) {
  const appliesTo = toggle(draft.value.appliesTo, kind)
  draft.value = {
    ...draft.value,
    appliesTo,
    isInheritable: isNew.value && !appliesTo.includes('stem') ? false : draft.value.isInheritable,
  }
}

const optionList = ref<HTMLElement>()
async function addOption() {
  set('options', [...draft.value.options, { rowId: newRowId(), label: '', active: true }])
  await nextTick()
  optionList.value
    ?.querySelectorAll('input')
    .item(draft.value.options.length - 1)
    ?.focus()
}
// A new option belongs to the draft from the first keystroke. Its bin only appears once the field has been left for the first time (and stays),
// so the habitual click beside the field after typing cannot take the option back; until then the place is kept free, the field does not jump.
// Not part of the draft: it changes nothing that is saved.
const left = reactive(new Set<number>())
// Enter leaves the field (and must not submit the whole form); the Set is filled here too, as a field that is not focused fires no blur
function onOptionEnter(event: KeyboardEvent, index: number) {
  const option = draft.value.options[index]
  if (option.id) return
  event.preventDefault()
  left.add(option.rowId)
  ;(event.target as HTMLInputElement).blur()
}

// The options can be sorted by their handle (dragging or arrow keys); it only changes the form, "Speichern" saves it
const moveOption = (from: number, to: number) =>
  set('options', moveItem(draft.value.options, from, to))
const optionReorder = useReorder(moveOption)
function dragOption(event: PointerEvent, index: number) {
  optionReorder.start(event, index, () => [...(optionList.value?.children ?? [])] as HTMLElement[])
}
async function moveOptionBy(index: number, direction: -1 | 1) {
  const to = index + direction
  if (to < 0 || to >= draft.value.options.length) return
  const rowId = draft.value.options[index].rowId
  moveOption(index, to)
  // The moved row is put back in its place in the DOM, which takes the focus along unless it is given back
  await nextTick()
  optionList.value?.querySelector<HTMLElement>(`[data-row="${rowId}"] button[data-handle]`)?.focus()
}
function setOption(index: number, change: Partial<AttributeDraft['options'][number]>) {
  set(
    'options',
    draft.value.options.map((option, position) =>
      position === index ? { ...option, ...change } : option,
    ),
  )
}

// The text of a system attribute
const appliesText = computed(() =>
  props.attribute?.applies_to.map((kind) => KIND_LABELS[kind]).join(', '),
)
const yesNo = (value: boolean) => (value ? 'Ja' : 'Nein')
const hiddenBy = computed(() =>
  (props.attribute?.hidden_when ?? []).map(
    (key) => props.candidates.find((candidate) => candidate.key === key)?.name ?? key,
  ),
)

const field =
  'h-11 w-full rounded-lg border-2 border-ink bg-paper px-3 text-base text-ink aria-invalid:border-2 aria-invalid:bg-well'
const button = 'h-11 rounded-lg border-2 px-4 font-bold whitespace-nowrap'
// The symbol buttons beside an option (bin, eye): as tall as the field, 44 px wide
const iconButton = 'flex size-11 shrink-0 items-center justify-center rounded-lg border-2'
function existingOptionLabel(option: AttributeDraft['options'][number], index: number) {
  const text = option.label.trim() || `Auswahl-Option ${index + 1}`
  return `„${text}“ ${option.active ? 'deaktivieren' : 'aktivieren'}`
}
function newOptionLabel(option: AttributeDraft['options'][number]) {
  const text = option.label.trim()
  return text ? `„${text}“ löschen` : 'Leere Auswahl-Option löschen'
}
</script>

<template>
  <!-- Padding 20 px on all sides; no line above the buttons (as there is none below the heading), 24 px between the last row and them -->
  <section class="card" :aria-labelledby="`${id}-heading`">
    <div class="px-5 pt-5" :class="attribute?.is_system ? 'pb-2' : 'pb-0'">
      <!-- The heading is the first row, so that the X sits in the corner beside it; the note of a system attribute follows right below -->
      <div class="flex items-center justify-between gap-3">
        <h2
          :id="`${id}-heading`"
          ref="heading"
          tabindex="-1"
          class="text-display font-bold wrap-anywhere"
        >
          {{ attribute ? attribute.name : 'Neues Merkmal' }}
        </h2>
        <!-- An existing attribute can be closed (the selection ends); a new one has "Abbrechen" -->
        <button
          v-if="attribute"
          type="button"
          class="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg"
          aria-label="Schließen"
          title="Schließen"
          @click="emit('close')"
        >
          <XIcon :size="24" aria-hidden="true" />
        </button>
      </div>
      <p
        v-if="attribute?.is_system"
        class="mt-1 flex items-start gap-2 rounded-lg bg-well p-3 text-base"
      >
        <LockIcon :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
        Systemmerkmal: Ändern nur im Code möglich.
      </p>

      <!-- System attribute: values as text, nothing to operate -->
      <div v-if="attribute && attribute.is_system">
        <div class="mt-2 divide-y divide-soft">
          <dl class="divide-y divide-soft">
            <div
              class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
            >
              <dt class="text-caption font-semibold wrap-anywhere text-mute">Typ</dt>
              <dd class="wrap-anywhere text-ink">{{ TYPE_LABELS[attribute.type] }}</dd>
            </div>
            <div
              v-if="attribute.type === 'number' && attribute.unit"
              class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
            >
              <dt class="text-caption font-semibold wrap-anywhere text-mute">Einheit</dt>
              <dd class="wrap-anywhere text-ink">{{ attribute.unit }}</dd>
            </div>
            <div
              v-if="attribute.type === 'choice'"
              class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
            >
              <dt class="text-caption font-semibold wrap-anywhere text-mute">Auswahl-Optionen</dt>
              <dd class="wrap-anywhere text-ink">
                <ul>
                  <li v-for="option in attribute.options" :key="option.id">
                    <span :class="!option.active && 'line-through'">{{ option.label }}</span>
                    <span v-if="!option.active" class="ml-2 text-sm text-mute">(deaktiviert)</span>
                  </li>
                </ul>
              </dd>
            </div>
          </dl>
          <StemBeamSection :text="stemBeamText(attribute.applies_to, attribute.is_inheritable)">
            <dl class="divide-y divide-soft">
              <div
                class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
              >
                <dt class="text-caption font-semibold wrap-anywhere text-mute">Gültig für</dt>
                <dd class="wrap-anywhere text-ink">{{ appliesText }}</dd>
              </div>
              <div
                v-if="attribute.applies_to.includes('stem')"
                class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
              >
                <dt class="text-caption font-semibold wrap-anywhere text-mute">Wert vererbbar</dt>
                <dd class="wrap-anywhere text-ink">{{ yesNo(attribute.is_inheritable) }}</dd>
              </div>
            </dl>
          </StemBeamSection>
          <dl class="divide-y divide-soft">
            <div
              v-if="SERIES_TYPES.includes(attribute.type)"
              class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
            >
              <dt class="text-caption font-semibold wrap-anywhere text-mute">Serie</dt>
              <dd class="wrap-anywhere text-ink">{{ yesNo(attribute.is_series) }}</dd>
            </div>
            <div
              class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
            >
              <dt class="text-caption font-semibold wrap-anywhere text-mute">Anzeige-Bedingung</dt>
              <dd class="wrap-anywhere text-ink">
                <template v-if="hiddenBy.length">
                  Ausgeblendet, wenn gesetzt: {{ hiddenBy.join(', ') }}
                </template>
                <template v-else>Immer angezeigt</template>
              </dd>
            </div>
            <div
              class="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline sm:gap-y-0"
            >
              <dt class="text-caption font-semibold wrap-anywhere text-mute">Aktiv</dt>
              <dd class="wrap-anywhere text-ink">{{ yesNo(attribute.active) }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- Any other attribute: the form -->
      <form
        v-else
        :id="`${id}-form`"
        ref="form"
        class="mt-2 divide-y divide-soft"
        @submit.prevent="emit('save')"
      >
        <!-- The type as text; "ändern" leads to the tiles (and back to the form with the new type, keeping what was typed). With values it
             can no longer be changed: the locked display -->
        <SettingsRow v-if="!locked" label="Typ" :error="errors.type">
          <div class="flex min-h-11 items-center gap-3">
            <span class="font-bold">{{ tileLabel }}</span>
            <button
              type="button"
              class="flex h-11 items-center gap-2 rounded-lg px-2 underline active:bg-ink active:text-paper"
              @click="emit('changeType')"
            >
              <PencilIcon :size="18" aria-hidden="true" />
              ändern
            </button>
          </div>
        </SettingsRow>

        <SettingsRow v-else label="Typ" :label-for="`${id}-type`" :error="errors.type">
          <div
            :id="`${id}-type`"
            class="flex h-11 items-center gap-2 rounded-lg border-2 border-lockline bg-locked px-3 text-mute"
          >
            <span class="flex-1">{{ TYPE_LABELS[draft.type] }}</span>
            <LockIcon :size="18" aria-hidden="true" />
          </div>
          <template #hint>
            <p class="text-sm text-mute">Nicht mehr änderbar: Es sind schon Werte erfasst.</p>
          </template>
        </SettingsRow>

        <SettingsRow label="Name" :label-for="`${id}-name`" :error="errors.name">
          <input
            :id="`${id}-name`"
            :value="draft.name"
            type="text"
            autocomplete="off"
            :class="field"
            :aria-invalid="!!errors.name"
            @input="set('name', ($event.target as HTMLInputElement).value)"
          />
        </SettingsRow>

        <SettingsRow
          label="Beschreibung"
          :label-for="`${id}-description`"
          :error="errors.description"
        >
          <textarea
            :id="`${id}-description`"
            :value="draft.description"
            rows="2"
            placeholder="Hinweis für die Erfassung (optional)"
            class="min-h-[72px] w-full resize-y rounded-lg border-2 border-ink bg-paper px-3 py-2 text-base text-ink placeholder:text-dim"
            @input="set('description', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </SettingsRow>

        <SettingsRow
          v-if="!locked && (draft.type === 'date' || draft.type === 'month')"
          label="Genauigkeit"
          :label-for="`${id}-precision`"
        >
          <select
            :id="`${id}-precision`"
            :value="draft.type"
            :class="field"
            @change="
              draft = withType(draft, ($event.target as HTMLSelectElement).value as AttributeType)
            "
          >
            <option value="date">Tag</option>
            <option value="month">Monat</option>
          </select>
        </SettingsRow>

        <SettingsRow
          v-if="draft.type === 'number'"
          label="Einheit"
          :label-for="`${id}-unit`"
          :error="errors.unit"
        >
          <input
            :id="`${id}-unit`"
            :value="draft.unit"
            type="text"
            autocomplete="off"
            :class="field"
            :aria-invalid="!!errors.unit"
            @input="set('unit', ($event.target as HTMLInputElement).value)"
          />
        </SettingsRow>

        <SettingsRow
          v-if="draft.type === 'choice'"
          label="Auswahl-Optionen"
          :error="errors.options"
        >
          <ul ref="optionList" class="flex flex-col gap-2">
            <li
              v-for="(option, index) in draft.options"
              :key="option.rowId"
              :data-row="option.rowId"
              :style="optionReorder.style(index)"
              class="bg-paper"
            >
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  data-handle
                  class="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-[#888] hover:text-ink"
                  :aria-label="`${option.label.trim() || `Auswahl-Option ${index + 1}`} verschieben`"
                  title="Ziehen, oder mit Pfeil hoch und runter verschieben"
                  @pointerdown="dragOption($event, index)"
                  @keydown.up.prevent="moveOptionBy(index, -1)"
                  @keydown.down.prevent="moveOptionBy(index, 1)"
                >
                  <GripVerticalIcon :size="22" aria-hidden="true" />
                </button>
                <input
                  :value="option.label"
                  type="text"
                  autocomplete="off"
                  :aria-label="`Auswahl-Option ${index + 1}`"
                  :class="[field, 'self-baseline', !option.active && 'text-mute line-through']"
                  :aria-invalid="!!errors[`options.${index}.label`]"
                  :data-error="errors[`options.${index}.label`] ? '' : undefined"
                  @input="setOption(index, { label: ($event.target as HTMLInputElement).value })"
                  @keydown.enter="onOptionEnter($event, index)"
                  @blur="!option.id && left.add(option.rowId)"
                />
                <!-- The column right of the field is 44 px wide: the eye (deactivate or activate) of an existing option, the bin of a new one once its
                     field was left for the first time (it is not in the database yet). While it is typed in nothing is reserved: the field reaches the
                     right edge of the symbol buttons, as wide as "Auswahl-Option hinzufügen", and gets narrower when the bin appears -->
                <div v-if="option.id || left.has(option.rowId)" class="flex w-11 shrink-0">
                  <template v-if="!option.id">
                    <button
                      type="button"
                      :class="[iconButton, 'border-ink']"
                      :aria-label="newOptionLabel(option)"
                      :title="newOptionLabel(option)"
                      @click="
                        set(
                          'options',
                          draft.options.filter((_, position) => position !== index),
                        )
                      "
                    >
                      <TrashIcon :size="22" aria-hidden="true" />
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    :class="[iconButton, 'border-ink']"
                    :aria-label="existingOptionLabel(option, index)"
                    :title="existingOptionLabel(option, index)"
                    @click="setOption(index, { active: !option.active })"
                  >
                    <EyeOffIcon v-if="option.active" :size="22" aria-hidden="true" />
                    <EyeIcon v-else :size="22" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p
                v-if="errors[`options.${index}.label`]"
                class="mt-1 text-sm font-semibold"
                role="alert"
              >
                {{ errors[`options.${index}.label`] }}
              </p>
            </li>
          </ul>
          <!-- From the left edge of the text fields (40 px handle and 4 px gap = 44 px in, the handle area stays free) to the right edge of the
               symbol buttons; 16 px below the last option (6 px of the column's gap and 10 px), the options are 8 px apart -->
          <button
            type="button"
            class="mt-2.5 ml-11 flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink font-bold"
            @click="addOption"
          >
            <PlusIcon :size="18" aria-hidden="true" />
            Auswahl-Option hinzufügen
          </button>
        </SettingsRow>

        <StemBeamSection :text="stemBeamText(draft.appliesTo, draft.isInheritable)">
          <div class="divide-y divide-soft">
            <SettingsRow label="Gültig für" :error="errors.applies_to">
              <CheckboxRow
                v-for="(label, kind) in KIND_LABELS"
                :key="kind"
                :checked="draft.appliesTo.includes(kind)"
                @change="toggleKind(kind)"
              >
                {{ label }}
              </CheckboxRow>
            </SettingsRow>

            <SettingsRow
              v-if="draft.appliesTo.includes('stem')"
              label="Wert vererbbar"
              :error="errors.is_inheritable"
            >
              <template #default="{ labelId }">
                <CheckboxRow
                  :checked="draft.isInheritable"
                  :disabled="locked"
                  :labelledby="labelId"
                  @change="set('isInheritable', $event)"
                >
                  Ja
                  <LockIcon
                    v-if="locked"
                    :size="16"
                    class="ml-2 inline-block align-[-2px]"
                    aria-hidden="true"
                  />
                </CheckboxRow>
              </template>
              <template #hint>
                <p v-if="locked" class="text-sm text-mute">
                  Nicht mehr änderbar: Es sind schon Werte erfasst.
                </p>
              </template>
            </SettingsRow>
          </div>
        </StemBeamSection>

        <SettingsRow v-if="seriesPossible" label="Serie" :error="errors.is_series">
          <CheckboxRow
            :checked="draft.isSeries"
            :disabled="locked"
            @change="set('isSeries', $event)"
          >
            Jeder Eintrag wird zu einer Liste hinzugefügt
            <LockIcon
              v-if="locked"
              :size="16"
              class="ml-2 inline-block align-[-2px]"
              aria-hidden="true"
            />
          </CheckboxRow>
          <template #hint>
            <p v-if="locked" class="text-sm text-mute">
              Nicht mehr änderbar: Es sind schon Werte erfasst.
            </p>
          </template>
        </SettingsRow>

        <SettingsRow label="Anzeige-Bedingung" :error="errors.hidden_when">
          <p class="text-sm text-mute">Ausblenden, wenn folgende Merkmale gesetzt sind:</p>
          <CheckboxRow
            v-for="candidate in candidates"
            :key="candidate.id"
            :checked="draft.hiddenWhen.includes(candidate.key!)"
            @change="set('hiddenWhen', toggle(draft.hiddenWhen, candidate.key!))"
          >
            {{ candidate.name }}
          </CheckboxRow>
        </SettingsRow>

        <SettingsRow label="Aktiv" :error="errors.active">
          <CheckboxRow :checked="draft.active" @change="set('active', $event)">
            In der App sichtbar
          </CheckboxRow>
        </SettingsRow>
      </form>
    </div>

    <div
      v-if="!attribute?.is_system"
      class="flex flex-wrap items-center justify-end gap-3 px-5 pt-6 pb-5"
    >
      <p v-if="failed" class="mr-auto text-sm font-semibold" role="alert">
        {{ isNew ? 'Anlegen' : 'Speichern' }} fehlgeschlagen. Bitte noch einmal versuchen.
      </p>
      <button
        type="button"
        :class="[button, 'border-ink disabled:border-line disabled:text-dim']"
        :disabled="isNew ? saving : !changed || saving"
        @click="isNew ? emit('cancel') : emit('reset')"
      >
        {{ isNew ? 'Abbrechen' : 'Verwerfen' }}
      </button>
      <button
        type="submit"
        :form="`${id}-form`"
        :class="[
          button,
          'border-ink bg-ink text-paper disabled:border-disabled disabled:bg-disabled',
        ]"
        :disabled="(!isNew && !changed) || saving"
      >
        {{ isNew ? 'Anlegen' : 'Speichern' }}
      </button>
    </div>
  </section>
</template>
