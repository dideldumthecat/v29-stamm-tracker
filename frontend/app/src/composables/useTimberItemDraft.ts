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
import { plural } from '@/utils/plural'
import { bySortOrder } from '@v29/shared/attributes'
import {
  fieldMode,
  isEditable,
  itemRoles,
  SAWN_KEY,
  splitChoiceOf,
  type FieldMode,
  type SplitChoice,
} from '@/stores/itemRoles'
import { useToast } from '@/composables/useToast'

/**
 * Everything the timber item screen holds only in memory until "Speichern": field input, photos and beams.
 * A crash or reload loses it, so the store is told while it exists (the app update and the download wait).
 *
 * It also decides which fields the form shows (`fields`): that depends on the draft itself ("Gesägt", the split choice, draft beams).
 *
 * item: undefined while the stem is not recorded yet; saving creates it with `tagNumber`.
 */
export function useTimberItemDraft(item: Ref<TimberItem | undefined>, tagNumber: () => string) {
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

  // --- Roles and the split choice (see stores/itemRoles.ts) -----------------
  const isBeam = computed(() => item.value?.parent_id != null)
  const hasSavedBeams = computed(() => item.value?.has_children ?? false)
  const sawnId = computed(
    () => store.attributes.find((attribute) => attribute.key === SAWN_KEY)?.id ?? '',
  )
  const recordedYes = (attributeId: string) =>
    item.value?.values[attributeId]?.slice(-1)[0]?.value === true
  const isYes = (key: string) => {
    const id = store.attributes.find((attribute) => attribute.key === key)?.id ?? ''
    const input = draft.value[id]
    return typeof input === 'boolean' ? input : recordedYes(id)
  }
  const recordedSawn = computed(() => recordedYes(sawnId.value))
  const sawn = computed(() => isYes(SAWN_KEY))
  // The user's answer to the dialog in this draft; null = follows from the state.
  const picked = ref<SplitChoice | null>(null)
  const splitChoice = computed(() =>
    isBeam.value
      ? null
      : splitChoiceOf({
          sawn: sawn.value,
          recordedSawn: recordedSawn.value,
          hasSavedBeams: hasSavedBeams.value,
          draftBeamCount: draftBeams.value.length,
          picked: picked.value,
        }),
  )
  const roles = computed(() =>
    itemRoles({
      isBeam: isBeam.value,
      sawn: sawn.value,
      hasBeams: hasSavedBeams.value || draftBeams.value.length > 0,
      choice: splitChoice.value,
    }),
  )
  const appliesNow = (attribute: Attribute) =>
    attribute.applies_to.some((kind) => roles.value.kinds.includes(kind))

  // A stem can be split wherever "Gesägt" is offered: splitting sets it.
  const canSplit = computed(() => {
    const sawnAttribute = store.attributes.find((attribute) => attribute.id === sawnId.value)
    return !isBeam.value && !!sawnAttribute?.active
  })

  // The form in the order V29 set. Input typed before the stem got locked, for an attribute the lock closes
  // (one the beams take too), stays an input until it is saved: it is saved with the stem, so it must not vanish from the screen.
  const fields = computed(() =>
    [...store.attributes].sort(bySortOrder).flatMap((attribute) => {
      const id = attribute.id
      const lockedOnly = attribute.active && appliesNow(attribute) && roles.value.locked
      const hasDraft =
        draft.value[id] !== undefined ||
        (added.value[id]?.length ?? 0) > 0 ||
        draftPhotos.value.some((photo) => photo.attributeId === id)
      const editable = isEditable(attribute, roles.value, hasSavedBeams.value)
      const mode: FieldMode =
        attribute.type !== 'photo' && lockedOnly && hasDraft
          ? 'input'
          : // Draft photos count as a value (they keep their previews); other draft input for a field that does not fit is not shown.
            fieldMode(
              editable,
              (attribute.type === 'photo' && hasDraft) || !!item.value?.values[id],
            )
      return mode === 'hidden' ? [] : [{ attribute, mode }]
    }),
  )

  // Draft values that differ from what is recorded, plus input that cannot be recorded yet.
  // Input for an attribute that no longer fits the item (beam attributes after "Mehrere Balken") is left out, not deleted:
  // it comes back with the field.
  const collected = computed(() =>
    collectDraft(store.attributes.filter(appliesNow), draft.value, added.value, item.value?.values),
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

  // "Gesägt" was ticked on a stem: it only counts with the answer whether the stem was split. The screen asks at once;
  // until then the tick is not in the draft, so cancelling leaves nothing behind.
  const isAskingSplit = ref(false)
  // Unticking "Gesägt" would throw the draft beams away; the screen asks first.
  const pendingBeamDiscard = ref(false)

  function setField(attribute: Attribute, input: DraftInput | undefined) {
    if (attribute.id === sawnId.value && !isBeam.value) {
      if (input === true) {
        isAskingSplit.value = true
        return
      }
      if (draftBeams.value.length > 0) {
        pendingBeamDiscard.value = true
        return
      }
      picked.value = null
    }
    draft.value[attribute.id] = input
  }

  // The answer to the question, or the first tap on "Balken A und B hinzufügen" ('split' without the question).
  // To take 'split' back, the draft beams are removed; "Gesägt" then stays on "ja".
  function chooseSplit(choice: SplitChoice) {
    isAskingSplit.value = false
    draft.value[sawnId.value] = true
    picked.value = choice
    // Two beams to start with: fewer would not be a split.
    if (choice === 'split' && !hasSavedBeams.value && draftBeams.value.length === 0) {
      for (let count = 0; count < 2; count++) {
        const tag = store.nextBeamTagOf(item.value, tagNumber(), draftBeams.value)
        if (tag) {
          draftBeams.value = [...draftBeams.value, tag]
        }
      }
    }
  }

  function discardDraftBeams() {
    draftBeams.value = []
    draft.value[sawnId.value] = false
    picked.value = null
    pendingBeamDiscard.value = false
  }

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
          before: `${plural(skipped, 'Foto konnte', 'Fotos konnten')} nicht gelesen werden`,
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
      ...(item.value ? store.pendingPhotosOf(item.value.id, attributeId) : []).map((photo) => ({
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

  // Error and series values go only to the fields that have them: an unknown prop would end up as an HTML attribute.
  function extraFieldProps(attribute: Attribute) {
    const error = shownErrors.value[attribute.id]
    if (attribute.type === 'month') {
      return { error }
    }
    if (attribute.type === 'number') {
      return {
        error,
        added: added.value[attribute.id],
        'onUpdate:added': (values: AttributeValue[]) => (added.value[attribute.id] = values),
      }
    }
    return {}
  }

  // What the leave dialog lists: only the parts that exist. Values and invalid input follow the form's order.
  const unsaved = computed(() => {
    const photoCount = draftPhotos.value.length
    const values: string[] = []
    const invalid: string[] = []
    for (const { attribute } of fields.value) {
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
    failedInputs.value = Object.fromEntries(errorIds.map((id) => [id, draft.value[id]]))
    if (errorIds.length > 0) {
      return null
    }
    // Take the lists before writing: afterwards the draft equals the store and `changes` would be empty.
    const toSave = changes.value
    const photosToSave = draftPhotos.value
    const beamsToSave = draftBeams.value
    // Like the click prototype: a new item is created even without values.
    // Only plain tags get here without an item: unknown beams are sent back by the router guard.
    // One transaction: a crash must not leave a photo without its stem or a stem without its photo.
    // The beams come last: once a stem has beams, it accepts only notes, and they inherit what was just recorded.
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
    picked.value = null
    formKey.value++
    return target
  }

  return {
    draft,
    fields,
    roles,
    sawn,
    hasSavedBeams,
    canSplit,
    splitChoice,
    isAskingSplit,
    pendingBeamDiscard,
    setField,
    chooseSplit,
    discardDraftBeams,
    draftBeams,
    formKey,
    isDirty,
    isCompressing,
    isPicking,
    addPhotos,
    photosOf,
    removePhoto,
    unsaved,
    save,
    extraFieldProps,
  }
}
