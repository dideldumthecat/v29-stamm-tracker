import { computed, onUnmounted, ref, watchEffect, type Ref } from 'vue'
import type { AttributeValue } from '@v29/shared/contract'
import { useTimberItemStore, type Attribute, type TimberItem } from '@/stores/timberItems'
import {
  collectDraft,
  formatPhotoCount,
  formatValueLine,
  type DraftInput,
} from '@/utils/attributeDraft'
import { attachPhotos } from '@/utils/photo'
import { useToast } from '@/composables/useToast'

/**
 * Everything the timber item screen holds only in memory until "Speichern": field input, photos and beams.
 * A crash or reload loses it, so the store is told while it exists (the app update and the download wait).
 *
 * item: undefined while the stem is not recorded yet; saving creates it with `tagNumber`.
 * attributes: the fields as the form shows them, for the order of the leave dialog.
 */
export function useTimberItemDraft(
  item: Ref<TimberItem | undefined>,
  tagNumber: () => string,
  attributes: Ref<Attribute[]>,
) {
  const store = useTimberItemStore()
  const toast = useToast()

  // Raw input per attribute id (see DraftInput). Only touched attributes have an entry.
  const draft = ref<Record<string, DraftInput | undefined>>({})
  // Series only: values already added with "Hinzufügen".
  const added = ref<Record<string, AttributeValue[]>>({})
  // `id` only keys the preview; the store gives the saved photo its own.
  const draftPhotos = ref<{ id: string; attributeId: string; blob: Blob }[]>([])
  // Letters are shown at once and never change, because the beam may be chalked before it is saved.
  const draftBeams = ref<string[]>([])
  // Incremented after saving to remount the fields: resets their local "unlocked" state.
  const formKey = ref(0)

  // Draft values that differ from what is recorded, plus input that cannot be recorded yet.
  const collected = computed(() =>
    collectDraft(store.attributes, draft.value, added.value, item.value?.values),
  )
  const changes = computed(() => collected.value.changes)
  // Invalid input counts as unsaved, so the leave dialog still protects it.
  const isDirty = computed(
    () =>
      changes.value.length > 0 ||
      Object.keys(collected.value.errors).length > 0 ||
      draftPhotos.value.length > 0 ||
      draftBeams.value.length > 0,
  )

  // An error appears only after a failed save and disappears once the input changes (as in the click prototype):
  // remember the input each error was shown for.
  const failedInputs = ref<Record<string, DraftInput | undefined>>({})
  const shownErrors = computed(() =>
    Object.fromEntries(
      Object.entries(collected.value.errors).filter(
        ([id]) => id in failedInputs.value && failedInputs.value[id] === draft.value[id],
      ),
    ),
  )

  const isCompressing = ref(false)
  // Camera or library open: the page may be reloaded by the system meanwhile, and the photo is not in the draft yet.
  // Without `cancel` support the flag stays until the screen closes, which only delays an update.
  const isPicking = ref(false)

  watchEffect(() => {
    store.setDraftOpen(isDirty.value || isCompressing.value || isPicking.value)
  })
  onUnmounted(() => {
    store.setDraftOpen(false)
  })

  async function addPhotos(attributeId: string, files: File[]) {
    isCompressing.value = true
    try {
      const { skipped } = await attachPhotos(files, (blob) => {
        draftPhotos.value.push({ id: crypto.randomUUID(), attributeId, blob })
      })
      if (skipped > 0) {
        toast.show({
          before: `${skipped} ${skipped === 1 ? 'Foto konnte' : 'Fotos konnten'} nicht gelesen werden`,
          kind: 'warning',
        })
      }
    } finally {
      isCompressing.value = false
    }
  }

  // Previews of the attribute: saved photos not uploaded yet, then the draft ones.
  // Saved photos are removable only while their event is still queued.
  function photosOf(attributeId: string) {
    return [
      ...(item.value ? store.pendingPhotosOf(item.value.id) : []).map((photo) => ({
        photo,
        removable: store.isPhotoQueued(photo.id),
      })),
      ...draftPhotos.value
        .filter((photo) => photo.attributeId === attributeId)
        .map((photo) => ({ photo, removable: true })),
    ]
  }

  function removePhoto(id: string) {
    if (draftPhotos.value.some((photo) => photo.id === id)) {
      draftPhotos.value = draftPhotos.value.filter((photo) => photo.id !== id)
    } else {
      store.removePhoto(id)
    }
  }

  // What the leave dialog lists: only the parts that exist. Values and invalid input follow the form's order.
  const unsaved = computed(() => {
    const photoCount = draftPhotos.value.length
    const values: string[] = []
    const invalid: string[] = []
    for (const attribute of attributes.value) {
      for (const change of changes.value) {
        if (change.attributeId === attribute.id) {
          values.push(formatValueLine(attribute, change.value))
        }
      }
      if (attribute.id in collected.value.errors) {
        invalid.push(`${attribute.name}: ungültige Eingabe`)
      }
    }
    return {
      fields: [...values, ...invalid],
      beams: [...draftBeams.value].sort((a, b) => a.localeCompare(b)),
      photos: photoCount > 0 ? formatPhotoCount(photoCount) : null,
    }
  })

  // Records the draft and resets it. null = invalid input blocks it; the errors are shown.
  // Only called with something to save: a dirty draft or a stem not recorded yet.
  function save(): TimberItem | null {
    const errorIds = Object.keys(collected.value.errors)
    if (errorIds.length > 0) {
      failedInputs.value = Object.fromEntries(errorIds.map((id) => [id, draft.value[id]]))
      return null
    }
    // Take the lists before writing: afterwards the draft equals the store and `changes` would be empty.
    const toSave = changes.value
    const photosToSave = draftPhotos.value
    const beamsToSave = draftBeams.value
    // Like the click prototype: a new item is created even without values.
    // Only plain tags get here without an item: unknown beams are sent back by the router guard.
    // One transaction: a crash must not leave a photo without its stem or a stem without its photo.
    // The beams come last: once a stem has beams, it accepts no more values, and they inherit what was just recorded.
    const target = store.inOneTransaction(() => {
      const target = item.value ?? store.createTimberItem(Number(tagNumber()))
      for (const change of toSave) {
        store.recordAttribute(target.id, change.attributeId, change.value)
      }
      for (const photo of photosToSave) {
        store.addPhoto(target.id, photo.attributeId, photo.blob)
      }
      for (const tag of beamsToSave) {
        store.addBeam(target.id, tag)
      }
      return target
    })

    draft.value = {}
    added.value = {}
    draftPhotos.value = []
    draftBeams.value = []
    failedInputs.value = {}
    formKey.value++
    return target
  }

  return {
    draft,
    added,
    draftBeams,
    formKey,
    isDirty,
    shownErrors,
    isCompressing,
    isPicking,
    addPhotos,
    photosOf,
    removePhoto,
    unsaved,
    save,
  }
}
