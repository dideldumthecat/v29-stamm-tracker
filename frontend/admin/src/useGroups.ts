import { computed, nextTick, ref } from 'vue'
import type {
  AdminAttribute,
  AdminAttributesResponse,
  AdminGroup,
  AdminGroupsResponse,
} from '@/api/contract'

import { ApiError, request } from '@/api/client'
import { bodyOf, draftOf, isChanged, newDraft, type GroupDraft } from '@/groups'
import { useAttempt } from '@/useAttempt'

/**
 * The state and the actions of the page "Gruppen": the list, the one open group with what is typed in its card, and the card that adds a group.
 * The view only draws it. The server checks everything (name, unknown attributes); its 422 lands at the field.
 */
export function useGroups() {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const failure = ref(0)
  const groups = ref<AdminGroup[]>([])
  const attributes = ref<AdminAttribute[]>([])
  const { busy, notice, attempt, say } = useAttempt()

  async function load() {
    status.value = 'loading'
    try {
      const [groupsAnswer, attributesAnswer] = await Promise.all([
        request<AdminGroupsResponse>('GET', 'admin/groups'),
        request<AdminAttributesResponse>('GET', 'admin/attributes'),
      ])
      groups.value = groupsAnswer.groups
      attributes.value = attributesAnswer.attributes
      status.value = 'ready'
    } catch (error) {
      failure.value = error instanceof ApiError ? error.status : 0
      status.value = 'error'
    }
  }
  void load()

  // The list stays sorted by name, as the server sorts it.
  const sorted = (list: AdminGroup[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const replace = (group: AdminGroup) =>
    (groups.value = sorted(groups.value.map((entry) => (entry.id === group.id ? group : entry))))

  // --- The open group ---------------------------------------------------------------------------------------------------------

  const openId = ref<string | null>(null)
  const openGroup = computed(() => groups.value.find((group) => group.id === openId.value) ?? null)
  // The table splits below the open row: the card of the group hangs in between.
  const split = computed(() => {
    const index = groups.value.findIndex((group) => group.id === openId.value)
    return index < 0
      ? { before: groups.value, after: [] }
      : { before: groups.value.slice(0, index + 1), after: groups.value.slice(index + 1) }
  })

  // What is typed in the card; thrown away with every other group opened.
  const draft = ref<GroupDraft>(newDraft())
  const saveErrors = ref<Record<string, string>>({})
  const changed = computed(() => !!openGroup.value && isChanged(openGroup.value, draft.value))

  function toggle(group: AdminGroup) {
    if (openId.value === group.id) {
      openId.value = null
      return
    }
    openId.value = group.id
    draft.value = draftOf(group)
    saveErrors.value = {}
  }

  const save = () =>
    attempt(
      async () => {
        saveErrors.value = {}
        const answer = await request<AdminGroup>(
          'PATCH',
          `admin/groups/${openId.value}`,
          bodyOf(draft.value),
        )
        replace(answer)
        openId.value = null
        say(`${answer.name} ist gespeichert.`)
      },
      (errors) => (saveErrors.value = errors),
    )

  const remove = (group: AdminGroup) =>
    attempt(async () => {
      await request('DELETE', `admin/groups/${group.id}`)
      groups.value = groups.value.filter((entry) => entry.id !== group.id)
      openId.value = null
      say(`${group.name} ist gelöscht.`)
    })

  // --- Add ---------------------------------------------------------------------------------------------------------------------

  const adding = ref(false)
  const newName = ref('')
  const createErrors = ref<Record<string, string>>({})

  /** Opens or closes the card; `onOpen` runs once it is on the screen (arrow, focus). */
  async function toggleAdd(onOpen: () => void) {
    adding.value = !adding.value
    if (!adding.value) return
    createErrors.value = {}
    await nextTick()
    onOpen()
  }

  const create = (onInvalid: () => void) =>
    attempt(
      async () => {
        createErrors.value = {}
        const answer = await request<AdminGroup>(
          'POST',
          'admin/groups',
          bodyOf({ ...newDraft(), name: newName.value }),
        )
        groups.value = sorted([...groups.value, answer])
        adding.value = false
        newName.value = ''
        toggle(answer)
        say(`${answer.name} ist angelegt.`)
      },
      (errors) => {
        createErrors.value = errors
        onInvalid()
      },
    )

  return {
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
  }
}
