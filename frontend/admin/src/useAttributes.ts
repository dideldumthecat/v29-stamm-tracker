import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type RouteLocationNormalized,
} from 'vue-router'
import type { AdminAttribute, AdminAttributesResponse } from '@/api/contract'

import { ApiError, request } from '@/api/client'
import { errorsOf } from '@/apiErrors'
import {
  applyVisibleOrder,
  bodyOf,
  draftOf,
  isChanged,
  moveItem,
  NEW_ATTRIBUTE,
  newDraft,
  previewOf,
  readQuery,
  sameDraft,
  tileOf,
  visibleAttributes,
  withNewType,
  writeQuery,
  type AttributeDraft,
  type AttributesQuery,
  type TileType,
} from '@/attributes'
import { useReorder } from '@/reorder'

/**
 * The state and the actions of the page "Merkmale": the list, the selection (the URL is its only source), the form of the selected attribute
 * or of a new one with its save, the order (dragging, saved at once) and the question before a change of the selection with unsaved changes.
 * The view only draws it; where the card stands and how the page scrolls is in `useAttributeCard`. The template refs `list` (the preview)
 * and `settings` (the form) belong to it.
 */
export function useAttributes() {
  const route = useRoute()
  const router = useRouter()
  const list = useTemplateRef<HTMLElement>('list')
  const settings = useTemplateRef<{
    focusFirstError: () => Promise<void>
    focusHeading: () => void
  }>('settings')

  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const failure = ref(0)
  const attributes = ref<AdminAttribute[]>([])

  async function load() {
    status.value = 'loading'
    try {
      attributes.value = (
        await request<AdminAttributesResponse>('GET', 'admin/attributes')
      ).attributes
      status.value = 'ready'
    } catch (error) {
      failure.value = error instanceof ApiError ? error.status : 0
      status.value = 'error'
    }
  }
  void load()

  // The URL is the only source of the view, "Inaktive zeigen" and the selection (an attribute, or `new` for the draft of a new one).
  const query = computed(() => readQuery(route.query))
  const isNew = computed(() => query.value.attribute === NEW_ATTRIBUTE)
  const visible = computed(() =>
    visibleAttributes(attributes.value, query.value.view, query.value.inactive),
  )
  // What is not in the preview is not selected, whatever the URL says
  const selected = computed(
    () => visible.value.find((attribute) => attribute.id === query.value.attribute) ?? null,
  )
  /** What is selected, as one value to compare: the draft, an attribute of the preview, or nothing. */
  const selectionOf = (next: AttributesQuery) =>
    next.attribute === NEW_ATTRIBUTE
      ? NEW_ATTRIBUTE
      : (visibleAttributes(attributes.value, next.view, next.inactive).find(
          (attribute) => attribute.id === next.attribute,
        )?.id ?? null)

  // Set while the page itself navigates away from a form it has just closed (after "Anlegen"): the question below does not apply
  let proceeding = false
  async function go(next: Partial<AttributesQuery>, force = false) {
    proceeding = force
    try {
      await router.push({ query: writeQuery({ ...query.value, ...next }) })
    } finally {
      proceeding = false
    }
  }
  // The selection goes with a view that does not show it, and a draft goes with any change of the view
  const keepsSelection = (view: AttributesQuery['view'], inactive: boolean) =>
    query.value.attribute !== NEW_ATTRIBUTE &&
    selectionOf({ ...query.value, view, inactive }) === query.value.attribute
      ? query.value.attribute
      : null
  const selectView = (view: AttributesQuery['view']) =>
    go({ view, attribute: keepsSelection(view, query.value.inactive) })
  const setInactive = (inactive: boolean) =>
    go({ inactive, attribute: keepsSelection(query.value.view, inactive) })
  const cancelNew = () => go({ attribute: null })

  // --- The form of the selected attribute or of the new one ------------------------------------------------------------------

  const draft = ref<AttributeDraft | null>(null)
  /** The type tiles or the form: a new attribute starts with the tiles, "ändern" at the type of an existing one leads to them too. */
  const newStep = ref<'type' | 'form'>('type')
  const errors = ref<Record<string, string>>({})
  const saving = ref(false)
  const saveFailed = ref(false)
  function resetDraft() {
    newStep.value = isNew.value ? 'type' : 'form'
    draft.value = selected.value ? draftOf(selected.value) : null
    errors.value = {}
    saveFailed.value = false
  }
  watch(() => (isNew.value ? NEW_ATTRIBUTE : selected.value?.id), resetDraft, { immediate: true })
  // An edit makes the messages of the last save out of date
  watch(draft, () => (errors.value = {}), { deep: true })

  // A draft counts as soon as it differs from the defaults of its type: choosing a type and leaving again loses nothing
  const changed = computed(() => {
    if (!draft.value) return false
    if (isNew.value) return !sameDraft(draft.value, newDraft(draft.value.type, query.value.view))
    return !!selected.value && isChanged(selected.value, draft.value)
  })

  function pickType(tile: TileType) {
    // The same tile again keeps a month a month
    const type = draft.value && tileOf(draft.value.type) === tile ? draft.value.type : tile
    draft.value = draft.value ? withNewType(draft.value, type) : newDraft(type, query.value.view)
    newStep.value = 'form'
  }
  const changeType = () => (newStep.value = 'type')
  const backToForm = () => (newStep.value = 'form')
  // The new attribute in the preview in place of the placeholder, once type and name are there
  const livePreview = computed(() =>
    isNew.value && newStep.value === 'form' && draft.value?.name.trim()
      ? previewOf(draft.value)
      : null,
  )

  // The attribute just created: it is where its placeholder was, so the page does not scroll to it (`useAttributeCard`)
  const createdId = ref<string | null>(null)

  async function save() {
    if (!draft.value || saving.value) return
    const creating = isNew.value
    const attribute = selected.value
    if (!creating && !attribute) return
    saving.value = true
    saveFailed.value = false
    try {
      if (creating) {
        const created = await request<AdminAttribute>(
          'POST',
          'admin/attributes',
          bodyOf(draft.value),
        )
        attributes.value = [...attributes.value, created]
        // It stays selected, now as an attribute: in a view where it shows (it may be for the other kind, or inactive)
        const view = created.applies_to.includes(query.value.view)
          ? query.value.view
          : created.applies_to[0]
        createdId.value = created.id
        await go(
          { view, inactive: query.value.inactive || !created.active, attribute: created.id },
          true,
        )
        await nextTick()
        settings.value?.focusHeading()
        confirmSaved(created)
        return
      }
      const saved = await request<AdminAttribute>(
        'PATCH',
        `admin/attributes/${attribute!.id}`,
        // The rest of a system attribute is fixed in the code: only what may change goes to the server
        attribute!.is_system
          ? { name: draft.value.name, description: draft.value.description }
          : bodyOf(draft.value),
      )
      attributes.value = attributes.value.map((entry) => (entry.id === saved.id ? saved : entry))
      // The selection stays; the form shows what the server made of it (trimmed texts, the options with ids)
      await nextTick()
      resetDraft()
      await nextTick()
      settings.value?.focusHeading()
      confirmSaved(saved)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        errors.value = errorsOf(error.body)
        // To the first field with a message (once the messages are drawn)
        await nextTick()
        settings.value?.focusFirstError()
      } else saveFailed.value = true
    } finally {
      saving.value = false
    }
  }

  // --- The order: dragging the handle or the arrow keys, saved at once -----------------------------------------------------------

  const ordering = ref(false)
  const orderFailed = ref(false)
  /** "Reihenfolge gespeichert" or "Merkmal gespeichert" beside the count, for about 3 seconds after a successful save. */
  const savedText = ref('')
  let savedTimer: ReturnType<typeof setTimeout> | undefined
  onBeforeUnmount(() => clearTimeout(savedTimer))
  /** What a screen reader hears once a move is saved (the live region; the message in the bar is hidden from it so nothing is read twice). */
  const announcement = ref('')
  const items = () =>
    [...(list.value?.children ?? [])].slice(0, visible.value.length) as HTMLElement[]
  const reorder = useReorder((from, to) => void moveAttribute(from, to))

  /** After a save: "Merkmal gespeichert" beside the count for about 3 seconds, and the same words for a screen reader. Nothing else moves. */
  async function confirmSaved(saved: AdminAttribute) {
    clearTimeout(savedTimer)
    savedText.value = 'Merkmal gespeichert'
    savedTimer = setTimeout(() => (savedText.value = ''), 3000)
    // Emptied first: the same words twice in a row are only read again if the region changed in between
    announcement.value = ''
    await nextTick()
    announcement.value = `Merkmal „${saved.name}“ gespeichert.`
  }

  /**
   * Moves the attribute at `from` in the preview to `to`. The order is global: the preview holds only the attributes of its view, they
   * take each other's places in the whole list and everything else stays where it is. The new order is shown at once and saved; if
   * that fails it goes back to the old one.
   */
  async function moveAttribute(from: number, to: number) {
    if (ordering.value) return
    const before = attributes.value
    const moved = visible.value[from]
    const next = applyVisibleOrder(before, moveItem(visible.value, from, to)).map(
      (attribute, index) => ({ ...attribute, sort_order: 10 * (index + 1) }),
    )
    attributes.value = next
    const where = `${moved.name} ist jetzt an Stelle ${to + 1} von ${visible.value.length}.`
    ordering.value = true
    orderFailed.value = false
    savedText.value = ''
    clearTimeout(savedTimer)
    // Emptied first: the same words twice in a row are only read again if the region changed in between
    announcement.value = ''
    try {
      await request('PUT', 'admin/attributes/order', {
        ids: next.map((attribute) => attribute.id),
      })
      announcement.value = `${where} Reihenfolge gespeichert.`
      savedText.value = 'Reihenfolge gespeichert'
      savedTimer = setTimeout(() => (savedText.value = ''), 3000)
    } catch {
      attributes.value = before
      orderFailed.value = true
    } finally {
      ordering.value = false
    }
  }
  async function moveBy(index: number, direction: -1 | 1) {
    const to = index + direction
    if (to < 0 || to >= visible.value.length) return
    const id = visible.value[index].id
    void moveAttribute(index, to)
    // The row moves in the DOM, which takes the focus off its handle: give it back
    await nextTick()
    list.value
      ?.querySelector<HTMLElement>(`[data-attribute="${id}"] button[aria-label$="verschieben"]`)
      ?.focus()
  }

  // --- Switching or leaving with unsaved changes --------------------------------------------------------------------------------

  // A change of the selection or the view asks first (the page stays where it is meanwhile); "Inaktive zeigen" only if the selection goes.
  // Leaving the page asks the same, except for the sign-in page: signing out and an expired session lose the draft without a question.
  // A route update is the one place for the first: the buttons, the preview and the browser's back button all pass here.
  const asking = ref(false)
  let pending: RouteLocationNormalized | null = null
  function ask(to: RouteLocationNormalized) {
    pending = to
    asking.value = true
    return false
  }
  onBeforeRouteUpdate((to) => {
    if (proceeding || !changed.value) return true
    const next = readQuery(to.query)
    if (next.view === query.value.view && selectionOf(next) === selectionOf(query.value))
      return true
    return ask(to)
  })
  onBeforeRouteLeave((to) => (proceeding || !changed.value || to.name === 'login' ? true : ask(to)))
  function discard() {
    resetDraft()
    const to = pending
    const closed = closing
    pending = null
    closing = null
    if (to) void router.push(to).then(() => closed && focusInPreview(closed))
  }
  watch(asking, (open) => {
    if (!open) {
      pending = null
      closing = null
    }
  })

  // The X of the form ends the selection (with the same question as any other change of the selection); the focus goes to the attribute that
  // was closed, once it is closed (after the question, if there was one)
  let closing: string | null = null
  function focusInPreview(id: string) {
    list.value
      ?.querySelector<HTMLElement>(
        `[data-attribute="${id}"] button:not([aria-label$="verschieben"])`,
      )
      ?.focus()
  }
  async function closeSelected() {
    const id = selected.value?.id
    if (!id) return
    closing = id
    await go({ attribute: null })
    if (asking.value) return
    closing = null
    await nextTick()
    focusInPreview(id)
  }

  return {
    list,
    status,
    failure,
    attributes,
    load,
    query,
    isNew,
    visible,
    selected,
    go,
    selectView,
    setInactive,
    cancelNew,
    draft,
    newStep,
    errors,
    saving,
    saveFailed,
    changed,
    pickType,
    changeType,
    backToForm,
    livePreview,
    createdId,
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
  }
}
