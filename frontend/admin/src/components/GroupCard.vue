<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AdminAttribute, AdminGroup } from '@/api/contract'

import CheckboxRow from '@/components/CheckboxRow.vue'
import { attributeMeta, type GroupDraft } from '@/groups'

/**
 * The card of the open group: name, which attributes the members see in the app, who the members are, delete. What is typed lives in the
 * draft of the page; this only draws it and reports "Speichern", "Abbrechen" and "Gruppe löschen". The group can only be deleted while it has no users.
 */
const props = defineProps<{
  group: AdminGroup
  attributes: AdminAttribute[]
  errors: Record<string, string>
  changed: boolean
  busy: boolean
}>()
const draft = defineModel<GroupDraft>('draft', { required: true })
defineEmits<{ save: []; cancel: []; remove: [] }>()

const id = useId()
const hasUsers = computed(() => props.group.users.length > 0)

function toggleAttribute(attributeId: string, checked: boolean) {
  const selected = draft.value.selected.filter((entry) => entry !== attributeId)
  draft.value = { ...draft.value, selected: checked ? [...selected, attributeId] : selected }
}

const button =
  'flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 font-bold whitespace-nowrap'
const row = 'grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)]'
const label = 'text-caption font-semibold text-mute'
</script>

<template>
  <form @submit.prevent="$emit('save')">
    <div class="divide-y divide-soft [&>*]:py-4 [&>:first-child]:pt-0 [&>:last-child]:pb-0">
      <div :class="[row, 'sm:items-center']">
        <label :for="`${id}-name`" :class="label">Name</label>
        <div>
          <input
            :id="`${id}-name`"
            v-model="draft.name"
            type="text"
            autocomplete="off"
            class="h-11 w-full rounded-lg border-2 border-ink bg-paper px-3 text-base text-ink aria-invalid:bg-well sm:max-w-[420px]"
            :aria-invalid="!!errors.name"
            :aria-describedby="errors.name ? `${id}-name-error` : undefined"
          />
          <p
            v-if="errors.name"
            :id="`${id}-name-error`"
            class="mt-1 text-sm font-semibold"
            role="alert"
          >
            {{ errors.name }}
          </p>
        </div>
      </div>

      <div :class="row">
        <p :id="`${id}-visible`" :class="[label, 'sm:pt-3']">Merkmale in der App</p>
        <div>
          <fieldset :aria-labelledby="`${id}-visible`" class="flex flex-col">
            <label class="relative block py-2 pl-8 leading-6">
              <input
                type="radio"
                :name="`${id}-mode`"
                class="absolute top-2.5 left-0 size-5 accent-ink"
                :checked="draft.seesAll"
                @change="draft = { ...draft, seesAll: true }"
              />
              Alle Merkmale, auch künftige
            </label>
            <label class="relative block py-2 pl-8 leading-6">
              <input
                type="radio"
                :name="`${id}-mode`"
                class="absolute top-2.5 left-0 size-5 accent-ink"
                :checked="!draft.seesAll"
                @change="draft = { ...draft, seesAll: false }"
              />
              Nur ausgewählte – neue Merkmale erst nach Freigabe
            </label>
          </fieldset>

          <div v-if="!draft.seesAll" class="mt-3 pl-8" data-attribute-list>
            <p class="font-semibold" :class="errors.attribute_ids && 'text-alert'">
              {{ draft.selected.length }} von {{ attributes.length }} ausgewählt
            </p>
            <p v-if="errors.attribute_ids" class="text-sm font-semibold" role="alert">
              {{ errors.attribute_ids }}
            </p>
            <ul class="mt-2 gap-x-10 sm:columns-2">
              <li
                v-for="attribute in attributes"
                :key="attribute.id"
                class="break-inside-avoid py-1"
              >
                <CheckboxRow
                  :checked="draft.selected.includes(attribute.id)"
                  @change="toggleAttribute(attribute.id, $event)"
                >
                  <span
                    class="block"
                    :class="!draft.selected.includes(attribute.id) && 'text-mute'"
                    >{{ attribute.name }}</span
                  >
                  <span class="block text-caption text-mute">{{ attributeMeta(attribute) }}</span>
                </CheckboxRow>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div :class="row">
        <p :id="`${id}-members`" :class="label">Nutzer</p>
        <div>
          <ul v-if="hasUsers" :aria-labelledby="`${id}-members`" class="flex flex-col gap-1">
            <li v-for="user in group.users" :key="user.id">{{ user.name }}</li>
          </ul>
          <p v-else class="text-mute">Noch keine Nutzer.</p>
          <p class="mt-4 text-mute">
            Wer zu welcher Gruppe gehört, legst du auf der Seite
            <RouterLink :to="{ name: 'users' }" class="underline">Nutzer</RouterLink> fest.
          </p>
        </div>
      </div>

      <div :class="row">
        <p :id="`${id}-delete`" :class="[label, 'sm:pt-3']">Löschen</p>
        <div>
          <button
            type="button"
            :class="[button, hasUsers ? 'border-line bg-well text-dim' : 'border-alert text-alert']"
            :disabled="hasUsers || busy"
            :aria-describedby="hasUsers ? `${id}-delete-hint` : undefined"
            @click="$emit('remove')"
          >
            Gruppe löschen
          </button>
          <p v-if="hasUsers" :id="`${id}-delete-hint`" class="mt-2 text-mute">
            Nur möglich, solange die Gruppe keine Nutzer hat.
          </p>
        </div>
      </div>
    </div>

    <div class="mt-6 flex justify-end gap-3">
      <button type="button" :class="[button, 'border-ink']" @click="$emit('cancel')">
        Abbrechen
      </button>
      <button
        type="submit"
        :class="[
          button,
          'border-ink bg-ink text-paper disabled:border-line disabled:bg-well disabled:text-dim',
        ]"
        :disabled="!changed || busy"
      >
        Speichern
      </button>
    </div>
  </form>
</template>
