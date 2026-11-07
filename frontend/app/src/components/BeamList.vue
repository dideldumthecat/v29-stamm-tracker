<script setup lang="ts">
import { computed } from 'vue'
import { PlusIcon, Trash2Icon } from '@lucide/vue'
import { useTimberItemStore, type TimberItem } from '@/stores/timberItems'
import { formatValue } from '@/utils/attributeDraft'
import { bySortOrder } from '@/utils/sort'
import { MAX_BEAMS } from '@/config/constants'
import BeamRowLabel from '@/components/BeamRowLabel.vue'
import FormattedTag from '@v29/shared/FormattedTag.vue'

const props = defineProps<{
  // undefined = stem not recorded yet.
  stem: TimberItem | undefined
  tagNumber: string
  // Opening a beam leaves the screen, so unsaved changes need an answer first.
  isDirty: boolean
}>()

// Beams added but not saved yet; they are created together with the stem on save.
const draftBeams = defineModel<string[]>('draftBeams', { required: true })

const emit = defineEmits<{
  // The beam cannot be opened before the stem is saved.
  saveFirst: [tag: string]
  remove: [beam: TimberItem]
}>()

const store = useTimberItemStore()

const nextBeam = computed(() => store.nextBeamTagOf(props.stem, props.tagNumber, draftBeams.value))

// A draft beam has no TimberItem yet.
const rows = computed(() =>
  [
    ...(props.stem ? store.childrenOf(props.stem.id) : []).map((beam) => ({
      tag: beam.tag_number!,
      beam,
    })),
    ...draftBeams.value.map((tag) => ({ tag, beam: undefined })),
  ].sort((a, b) => a.tag.localeCompare(b.tag)),
)

// First two own values in the order V29 set; inherited ones are the stem's, not worth repeating.
function summary(beam: TimberItem | undefined): string {
  const parts = beam
    ? [...store.attributes]
        .sort(bySortOrder)
        .filter(
          (attribute) => beam.values[attribute.id] && !store.isInherited(beam.id, attribute.id),
        )
        .map((attribute) => formatValue(attribute, beam.values[attribute.id]!.slice(-1)[0]!.value))
        .filter((text) => text !== null)
        .slice(0, 2)
    : []
  return parts.length > 0 ? parts.join(' · ') : 'noch keine eigenen Angaben'
}

// Nothing is saved or created here: the beam joins the draft and is created with "Speichern".
function onAdd() {
  if (nextBeam.value) {
    draftBeams.value = [...draftBeams.value, nextBeam.value]
  }
}

function onLink(event: MouseEvent, tag: string, navigate: (event: MouseEvent) => void) {
  if (props.isDirty) {
    event.preventDefault()
    emit('saveFirst', tag)
  } else {
    navigate(event)
  }
}

// A draft beam goes without asking; a saved one needs the confirmation.
function onRemove(row: { tag: string; beam: TimberItem | undefined }) {
  if (row.beam) {
    emit('remove', row.beam)
  } else {
    draftBeams.value = draftBeams.value.filter((tag) => tag !== row.tag)
  }
}
</script>

<template>
  <section
    class="flex flex-col gap-2.5 border-t border-line py-section px-gutter *:max-w-full *:min-w-0"
  >
    <h2 class="flex items-center gap-2 text-label font-bold">
      Balken<template v-if="rows.length > 0"> ({{ rows.length }})</template>
    </h2>
    <div v-if="rows.length > 0">
      <div v-for="row in rows" :key="row.tag" class="flex items-center gap-2 border-b border-line">
        <RouterLink
          v-if="row.beam"
          v-slot="{ href, navigate }"
          custom
          :to="{ name: 'timber-item', params: { tagNumber: row.tag } }"
        >
          <a
            :href="href"
            class="flex min-h-row min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
            @click="onLink($event, row.tag, navigate)"
          >
            <BeamRowLabel
              :tag-number="row.tag"
              :summary="summary(row.beam)"
              :note="store.isUnsynced(row.beam.id) ? 'nicht synchronisiert' : undefined"
            />
          </a>
        </RouterLink>
        <button
          v-else
          type="button"
          class="flex min-h-row min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
          @click="emit('saveFirst', row.tag)"
        >
          <BeamRowLabel
            :tag-number="row.tag"
            :summary="summary(undefined)"
            note="nicht gespeichert"
          />
        </button>
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-md border-2 border-ink bg-paper text-ink"
          :aria-label="`Balken ${row.tag} entfernen`"
          @click="onRemove(row)"
        >
          <Trash2Icon :size="20" :stroke-width="2.5" aria-hidden="true" />
        </button>
      </div>
    </div>
    <button
      type="button"
      class="flex h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink bg-paper text-label font-bold disabled:border-lockline disabled:text-mute"
      :disabled="!nextBeam"
      @click="onAdd"
    >
      <PlusIcon :size="22" :stroke-width="2.5" aria-hidden="true" />
      <span v-if="nextBeam">Balken <FormattedTag :tag-number="nextBeam" /> hinzufügen</span>
      <span v-else>Balken hinzufügen</span>
    </button>
    <span v-if="!nextBeam" class="text-caption text-mute"
      >Höchstens {{ MAX_BEAMS }} Balken je Stamm</span
    >
    <p v-if="rows.length === 0" class="text-sm leading-copy text-body">
      Nur wenn der Stamm in mehrere Balken gesägt wird: je Balken einmal tippen und die Kennung auf
      den Balken schreiben. Angaben, die für alle Balken gelten, am Stamm erfassen – mit dem
      Speichern ist der Stamm gesperrt.
    </p>
  </section>
</template>
