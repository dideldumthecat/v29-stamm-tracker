import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type {
  AdminGroup,
  AdminGroupsResponse,
  AdminInviteResponse,
  AdminUser,
  AdminUserResponse,
  AdminUsersResponse,
} from '@/api/contract'

import { ApiError, request } from '@/api/client'
import { defaultGroup } from '@/groups'
import { useAttempt } from '@/useAttempt'
import { bodyOf, draftOf, isChanged, newDraft, type UserDraft } from '@/users'

/**
 * The state and the actions of the page "Nutzer": the list, the one open user with what is typed in its card and the invite code, the
 * questions before "Neuer Code" and "Sperren", and the card that adds a user. The view only draws it. What the acting user may do comes
 * from the server with every user (`can_manage`, `can_block`, `can_set_role`, `creatable_roles`): the page only hides what is not allowed,
 * the server refuses it too.
 */
export function useUsers() {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const failure = ref(0)
  const users = ref<AdminUser[]>([])
  const creatableRoles = ref<AdminUsersResponse['creatable_roles']>(['user'])
  const groups = ref<AdminGroup[]>([])
  const { busy, notice, attempt, say } = useAttempt()

  async function load() {
    status.value = 'loading'
    try {
      const [answer, groupsAnswer] = await Promise.all([
        request<AdminUsersResponse>('GET', 'admin/users'),
        request<AdminGroupsResponse>('GET', 'admin/groups'),
      ])
      users.value = answer.users
      creatableRoles.value = answer.creatable_roles
      groups.value = groupsAnswer.groups
      newGroupId.value = defaultGroup(groups.value)?.id ?? ''
      status.value = 'ready'
    } catch (error) {
      failure.value = error instanceof ApiError ? error.status : 0
      status.value = 'error'
    }
  }

  const replace = (user: AdminUser) =>
    (users.value = users.value.map((entry) => (entry.id === user.id ? user : entry)))

  // --- The open user ---------------------------------------------------------------------------------------------------------

  const openId = ref<string | null>(null)
  const openUser = computed(() => users.value.find((user) => user.id === openId.value) ?? null)
  // The table splits below the open row: the card of the user hangs in between.
  const split = computed(() => {
    const index = users.value.findIndex((user) => user.id === openId.value)
    return index < 0
      ? { before: users.value, after: [] }
      : { before: users.value.slice(0, index + 1), after: users.value.slice(index + 1) }
  })

  // What is typed in the card; it is thrown away with every other user opened.
  const draft = ref<UserDraft>(newDraft())
  const saveErrors = ref<Record<string, string>>({})
  const changed = computed(() => !!openUser.value && isChanged(openUser.value, draft.value))

  // The code is a password: the server keeps no copy, so it exists only in the answer to "Anlegen" or "Neuer Code". It is shown while that user
  // stays open; closing, opening another user or leaving the page drops it.
  const code = ref<string | null>(null)
  const copied = ref(false)
  const copyFailed = ref(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  onBeforeUnmount(() => clearTimeout(copiedTimer))

  function select(user: AdminUser) {
    openId.value = user.id
    draft.value = draftOf(user)
    saveErrors.value = {}
    copied.value = false
    copyFailed.value = false
    code.value = null
  }

  function toggle(user: AdminUser) {
    if (openId.value === user.id) {
      openId.value = null
      return
    }
    select(user)
  }

  async function copy() {
    copyFailed.value = false
    try {
      await navigator.clipboard.writeText(code.value!)
    } catch {
      copyFailed.value = true
      return
    }
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 3000)
  }

  const save = () =>
    attempt(
      async () => {
        const user = openUser.value!
        const answer = await request<AdminUserResponse>(
          'PATCH',
          `admin/users/${user.id}`,
          bodyOf(user, draft.value),
        )
        replace(answer.user)
        openId.value = null
        say(`${answer.user.name} ist gespeichert.`)
      },
      (errors) => (saveErrors.value = errors),
    )

  // "Neuer Code" and "Sperren" act at once, whatever is typed in the card. Both ask first (the old code stops working, the user is out).
  const renewTarget = ref<AdminUser | null>(null)
  const renewOpen = ref(false)
  const askRenew = (user: AdminUser) => {
    renewTarget.value = user
    renewOpen.value = true
  }
  const renew = () => {
    const user = renewTarget.value!
    return attempt(async () => {
      const answer = await request<AdminInviteResponse>('POST', `admin/users/${user.id}/invite`)
      replace(answer.user)
      if (openId.value === user.id) code.value = answer.invite.code
      say(`Neuer Code für ${user.name}. Der alte gilt nicht mehr.`)
    })
  }

  const blockTarget = ref<AdminUser | null>(null)
  const blockOpen = ref(false)
  const askBlock = (user: AdminUser) => {
    blockTarget.value = user
    blockOpen.value = true
  }
  const setBlocked = (user: AdminUser, blocked: boolean) =>
    attempt(async () => {
      const answer = await request<AdminUserResponse>('PATCH', `admin/users/${user.id}`, {
        blocked,
      })
      replace(answer.user)
      say(blocked ? `${user.name} ist gesperrt.` : `${user.name} ist wieder freigegeben.`)
      // A code shown before does not work while the user is blocked
      if (blocked) code.value = null
    })

  // --- Add ---------------------------------------------------------------------------------------------------------------------

  const adding = ref(false)
  const newName = ref('')
  const newRole = ref<AdminUsersResponse['creatable_roles'][number]>('user')
  // The group of a new user, preselected as the server would choose it.
  const newGroupId = ref('')
  const createErrors = ref<Record<string, string>>({})

  /** Opens or closes the card; `onOpen` runs once it is on the screen (focus). */
  async function toggleAdd(onOpen: () => void) {
    adding.value = !adding.value
    if (!adding.value) return
    createErrors.value = {}
    await nextTick()
    onOpen()
  }

  /** `onInvalid` runs after the messages are set (focus); `onCreated` once the card of the new user is on the screen (scroll). */
  const create = (onInvalid: () => void, onCreated: () => void) =>
    attempt(
      async () => {
        createErrors.value = {}
        const answer = await request<AdminInviteResponse>('POST', 'admin/users', {
          name: newName.value,
          role: newRole.value,
          group_id: newGroupId.value,
        })
        users.value = [...users.value, answer.user]
        adding.value = false
        newName.value = ''
        select(answer.user)
        code.value = answer.invite.code
        say(`${answer.user.name} ist angelegt.`)
        await nextTick()
        onCreated()
      },
      (errors) => {
        createErrors.value = errors
        onInvalid()
      },
    )

  void load()

  return {
    status,
    failure,
    users,
    creatableRoles,
    groups,
    busy,
    notice,
    load,
    openId,
    openUser,
    split,
    draft,
    saveErrors,
    changed,
    code,
    copied,
    copyFailed,
    toggle,
    copy,
    save,
    renewTarget,
    renewOpen,
    askRenew,
    renew,
    blockTarget,
    blockOpen,
    askBlock,
    setBlocked,
    adding,
    newName,
    newRole,
    newGroupId,
    createErrors,
    toggleAdd,
    create,
  }
}
