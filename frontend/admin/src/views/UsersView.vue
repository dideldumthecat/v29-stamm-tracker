<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import type {
  AdminInviteResponse,
  AdminUser,
  AdminUserResponse,
  AdminUsersResponse,
} from '@v29/shared/contract'
import { CheckIcon, CopyIcon, PlusIcon, TriangleAlertIcon } from '@lucide/vue'

import { ApiError, request } from '@/api/client'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import LoadFailure from '@/components/LoadFailure.vue'
import LoadingStatus from '@/components/LoadingStatus.vue'
import ResultsBar from '@/components/ResultsBar.vue'
import SelectField from '@/components/SelectField.vue'
import UserTable from '@/components/UserTable.vue'
import { countUsers, isBlocked, ROLE_LABELS, userErrorsOf } from '@/users'

/**
 * The page "Nutzer": a table; one user at a time opens in a card below the row (name, role, invite code, new code, block). The button
 * above the table adds a user. What the acting user may do comes from the server with every user (`can_manage`, `can_block`,
 * `can_set_role`, `creatable_roles`): the page only hides what is not allowed, the server refuses it too.
 */
const id = useId()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const failure = ref(0)
const users = ref<AdminUser[]>([])
const creatableRoles = ref<AdminUsersResponse['creatable_roles']>(['user'])

async function load() {
  status.value = 'loading'
  try {
    const answer = await request<AdminUsersResponse>('GET', 'admin/users')
    users.value = answer.users
    creatableRoles.value = answer.creatable_roles
    status.value = 'ready'
  } catch (error) {
    failure.value = error instanceof ApiError ? error.status : 0
    status.value = 'error'
  }
}
void load()

// One request at a time; the outcome is said in a line next to the count (read out too).
const busy = ref(false)
const notice = ref<{ text: string; error: boolean } | null>(null)
async function attempt(
  run: () => Promise<void>,
  onInvalid?: (errors: Record<string, string>) => void,
) {
  if (busy.value) return
  busy.value = true
  notice.value = null
  try {
    await run()
  } catch (error) {
    if (error instanceof ApiError && error.status === 422 && onInvalid) {
      onInvalid(userErrorsOf(error.body))
    } else {
      notice.value = {
        text:
          error instanceof ApiError && error.status === 0
            ? 'Keine Verbindung zum Server. Bitte noch einmal versuchen.'
            : 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
        error: true,
      }
    }
  } finally {
    busy.value = false
  }
}
const say = (text: string) => (notice.value = { text, error: false })
const replace = (user: AdminUser) =>
  (users.value = users.value.map((entry) => (entry.id === user.id ? user : entry)))

// --- The open user ---------------------------------------------------------------------------------------------------------------

const openId = ref<string | null>(null)
const openUser = computed(() => users.value.find((user) => user.id === openId.value) ?? null)
// The table splits below the open row: the card of the user hangs in between.
const split = computed(() => {
  const index = users.value.findIndex((user) => user.id === openId.value)
  return index < 0
    ? { before: users.value, after: [] }
    : { before: users.value.slice(0, index + 1), after: users.value.slice(index + 1) }
})

// What is typed in the card; it is thrown away with every other user opened. Name and role are saved together with "Speichern".
const draft = ref<{ name: string; role: 'user' | 'admin' }>({ name: '', role: 'user' })
const saveErrors = ref<Record<string, string>>({})
const changed = computed(
  () =>
    !!openUser.value &&
    (draft.value.name.trim() !== openUser.value.name ||
      (openUser.value.can_set_role && draft.value.role !== openUser.value.role)),
)

// The code is a password: the server keeps no copy, so it exists only in the answer to "Anlegen" or "Neuer Code". It is shown while that user
// stays open; closing, opening another user or leaving the page drops it.
const code = ref<string | null>(null)
const copied = ref(false)
const copyFailed = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(copiedTimer))

function select(user: AdminUser) {
  openId.value = user.id
  draft.value = { name: user.name, role: user.role === 'admin' ? 'admin' : 'user' }
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
      const body: { name?: string; role?: string } = {}
      if (draft.value.name.trim() !== user.name) body.name = draft.value.name
      if (user.can_set_role && draft.value.role !== user.role) body.role = draft.value.role
      const answer = await request<AdminUserResponse>('PATCH', `admin/users/${user.id}`, body)
      replace(answer.user)
      openId.value = null
      say(`${answer.user.name} ist gespeichert.`)
    },
    (errors) => (saveErrors.value = errors),
  )

// "Neuer Code" and "Sperren" act at once, whatever is typed in the card. Both ask first (the old code stops working, the user is out).
const renewTarget = ref<AdminUser | null>(null)
const renewOpen = ref(false)
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
const setBlocked = (user: AdminUser, blocked: boolean) =>
  attempt(async () => {
    const answer = await request<AdminUserResponse>('PATCH', `admin/users/${user.id}`, { blocked })
    replace(answer.user)
    say(blocked ? `${user.name} ist gesperrt.` : `${user.name} ist wieder freigegeben.`)
    // A code shown before does not work while the user is blocked
    if (blocked) code.value = null
  })

// --- Add -------------------------------------------------------------------------------------------------------------------------

const adding = ref(false)
const newName = ref('')
const newRole = ref<AdminUsersResponse['creatable_roles'][number]>('user')
const createErrors = ref<Record<string, string>>({})
const nameField = useTemplateRef<HTMLInputElement>('nameField')
const addButton = useTemplateRef<HTMLButtonElement>('addButton')
const addCard = useTemplateRef<HTMLElement>('addCard')
const arrowRight = ref(32)

// The arrow of the card points at the middle of the real button: its distance from the right edge of the card, less its own half width
// (14 px) and the border of the card. The button sits at the right edge of the row, the card is as wide as the row.
function placeArrow() {
  if (!addButton.value || !addCard.value) return
  const button = addButton.value.getBoundingClientRect()
  const card = addCard.value.getBoundingClientRect()
  if (!button.width) return
  arrowRight.value = Math.round(card.right - (button.left + button.width / 2) - 7 - 1)
}
onMounted(() => window.addEventListener('resize', placeArrow))
onBeforeUnmount(() => window.removeEventListener('resize', placeArrow))

async function toggleAdd() {
  adding.value = !adding.value
  if (!adding.value) return
  createErrors.value = {}
  await nextTick()
  placeArrow()
  nameField.value?.focus()
}

const create = () =>
  attempt(
    async () => {
      createErrors.value = {}
      const answer = await request<AdminInviteResponse>('POST', 'admin/users', {
        name: newName.value,
        role: newRole.value,
      })
      users.value = [...users.value, answer.user]
      adding.value = false
      newName.value = ''
      select(answer.user)
      code.value = answer.invite.code
      say(`${answer.user.name} ist angelegt.`)
      await nextTick()
      document.getElementById(`${id}-panel`)?.scrollIntoView?.({ block: 'nearest' })
    },
    (errors) => {
      createErrors.value = errors
      nameField.value?.focus()
    },
  )

const button =
  'flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 font-bold whitespace-nowrap'
const field =
  'h-11 w-full rounded-lg border-2 border-ink bg-paper px-3 text-base text-ink aria-invalid:bg-well'
const label = 'text-caption font-semibold text-mute'
</script>

<template>
  <main class="py-8">
    <div class="page-column">
      <h1 class="text-3xl font-bold">Nutzer</h1>
      <p class="mt-2 text-measure text-mute">
        Wer in der App erfasst und wer die Administration nutzt. Gesperrte Nutzer kommen nicht mehr
        hinein, ihre Erfassungen bleiben erhalten.
      </p>

      <LoadFailure v-if="status === 'error'" :failure="failure" @retry="load" />
      <LoadingStatus v-else-if="status === 'loading'" role="status" />
    </div>

    <ResultsBar
      v-if="status === 'ready'"
      class="mt-4"
      :text="countUsers(users.length)"
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
          @click="toggleAdd"
        >
          <PlusIcon :size="20" aria-hidden="true" />
          Nutzer hinzufügen
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
        <h2 :id="`${id}-add-title`" class="text-label font-bold">Nutzer hinzufügen</h2>
        <form @submit.prevent="create">
          <div class="mt-4 flex flex-wrap items-start gap-x-6 gap-y-4">
            <div class="min-w-60 flex-1 basis-60 sm:max-w-[420px]">
              <label :for="`${id}-name`" :class="label">Name</label>
              <input
                :id="`${id}-name`"
                ref="nameField"
                v-model="newName"
                type="text"
                autocomplete="off"
                :class="[field, 'mt-1']"
                :aria-invalid="!!createErrors.name"
                :aria-describedby="`${id}-name-hint${createErrors.name ? ` ${id}-name-error` : ''}`"
              />
              <p
                v-if="createErrors.name"
                :id="`${id}-name-error`"
                class="mt-1 text-sm font-semibold"
                role="alert"
              >
                {{ createErrors.name }}
              </p>
              <p :id="`${id}-name-hint`" class="mt-1 text-caption text-mute">
                Steht in der App oben und an jeder Erfassung. Person oder Betrieb.
              </p>
            </div>
            <div v-if="creatableRoles.length > 1" class="w-full sm:w-48">
              <label :for="`${id}-role`" :class="label">Rolle</label>
              <SelectField :id="`${id}-role`" v-model="newRole" class="mt-1">
                <option v-for="role in creatableRoles" :key="role" :value="role">
                  {{ ROLE_LABELS[role] }}
                </option>
              </SelectField>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" :class="[button, 'border-ink']" @click="toggleAdd">
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
        <UserTable
          :users="split.before"
          head
          :square="openUser ? 'bottom' : undefined"
          :open-id="openId"
          :controls="`${id}-panel`"
          @toggle="toggle"
        />

        <!-- The card of the open user. The arrow sits under the chevron of the row above: 16 px padding of the cell plus half the chevron
               (10 px) and the padding of the table card (8 px) from the edge of the table, less half the arrow (7 px) and the border (1 px). -->
        <section
          v-if="openUser"
          :id="`${id}-panel`"
          class="relative my-4 card px-5 pt-[38px] pb-5 sm:px-6"
          :aria-label="`Einstellungen von ${openUser.name}`"
        >
          <span
            class="absolute -top-2 left-[26px] size-3.5 rotate-45 border-t border-l border-line bg-paper"
            data-card-arrow
            aria-hidden="true"
          />
          <form @submit.prevent="save">
            <div class="divide-y divide-soft [&>*]:py-4 [&>:first-child]:pt-0 [&>:last-child]:pb-0">
              <div class="grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                <label :for="`${id}-edit-name`" :class="label">Name</label>
                <div>
                  <input
                    :id="`${id}-edit-name`"
                    v-model="draft.name"
                    type="text"
                    autocomplete="off"
                    :class="[field, 'sm:max-w-[420px]']"
                    :aria-invalid="!!saveErrors.name"
                    :aria-describedby="saveErrors.name ? `${id}-edit-error` : undefined"
                  />
                  <p
                    v-if="saveErrors.name"
                    :id="`${id}-edit-error`"
                    class="mt-1 text-sm font-semibold"
                    role="alert"
                  >
                    {{ saveErrors.name }}
                  </p>
                </div>
              </div>

              <div>
                <div class="grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <p :id="`${id}-code-label`" :class="label">Einladungs-Code</p>
                  <div
                    class="flex flex-wrap items-center gap-x-4 gap-y-2"
                    role="group"
                    :aria-labelledby="`${id}-code-label`"
                  >
                    <template v-if="code && !isBlocked(openUser)">
                      <code
                        class="flex h-11 items-center rounded-lg border-2 border-ink bg-paper px-3 font-mono text-base tracking-[.08em]"
                        tabindex="0"
                        data-invite-code
                        >{{ code }}</code
                      >
                      <button
                        type="button"
                        :class="[button, 'border-ink bg-ink text-paper']"
                        @click="copy"
                      >
                        <component
                          :is="copied ? CheckIcon : CopyIcon"
                          :size="18"
                          aria-hidden="true"
                        />
                        {{ copied ? 'Kopiert' : 'Code kopieren' }}
                      </button>
                      <span class="sr-only" role="status">{{ copied ? 'Kopiert' : '' }}</span>
                      <p v-if="copyFailed" class="w-full font-semibold" role="alert">
                        Kopieren hat nicht geklappt. Markiere den Code und kopiere ihn von Hand.
                      </p>
                    </template>
                    <template v-else>
                      <p class="text-mute">Wird aus Sicherheitsgründen nicht gespeichert.</p>
                      <button
                        v-if="!isBlocked(openUser)"
                        type="button"
                        :class="[button, 'border-ink']"
                        :disabled="busy"
                        @click="((renewTarget = openUser), (renewOpen = true))"
                      >
                        Neuer Code
                      </button>
                    </template>
                  </div>
                </div>
                <!-- Over the whole width of the field, not held to the width of the code -->
                <div
                  v-if="code && !isBlocked(openUser)"
                  class="mt-4 flex items-center gap-3 rounded-lg bg-well px-4 py-3"
                  data-code-warning
                >
                  <TriangleAlertIcon :size="20" class="shrink-0" aria-label="Warnung" role="img" />
                  <p class="font-semibold">
                    Achtung! Der Code wird nur dieses eine Mal angezeigt, danach nie wieder. Falls
                    er verloren geht, muss ein neuer erstellt werden.
                  </p>
                </div>
              </div>

              <div class="grid gap-x-6 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                <label :for="`${id}-edit-role`" :class="label">Rolle</label>
                <SelectField
                  v-if="openUser.can_set_role"
                  :id="`${id}-edit-role`"
                  v-model="draft.role"
                  class="sm:w-48"
                >
                  <option value="user">{{ ROLE_LABELS.user }}</option>
                  <option value="admin">{{ ROLE_LABELS.admin }}</option>
                </SelectField>
                <p v-else :id="`${id}-edit-role`">{{ ROLE_LABELS[openUser.role] }}</p>
              </div>

              <div
                v-if="isBlocked(openUser) || openUser.can_block"
                class="grid gap-x-6 gap-y-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center"
              >
                <p :id="`${id}-access-label`" :class="label">Zugang</p>
                <div
                  class="flex flex-wrap gap-3"
                  role="group"
                  :aria-labelledby="`${id}-access-label`"
                >
                  <button
                    v-if="isBlocked(openUser)"
                    type="button"
                    :class="[button, 'border-ink']"
                    :disabled="busy"
                    @click="setBlocked(openUser, false)"
                  >
                    Entsperren
                  </button>
                  <button
                    v-else
                    type="button"
                    :class="[button, 'border-alert text-alert']"
                    :disabled="busy"
                    @click="((blockTarget = openUser), (blockOpen = true))"
                  >
                    Sperren
                  </button>
                </div>
              </div>
            </div>

            <div class="mt-6 flex justify-end gap-3">
              <button type="button" :class="[button, 'border-ink']" @click="openId = null">
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
        </section>

        <UserTable
          v-if="split.after.length"
          :users="split.after"
          :head="false"
          square="top"
          :open-id="openId"
          :controls="`${id}-panel`"
          @toggle="toggle"
        />
      </div>
    </div>

    <ConfirmDialog
      v-model:open="renewOpen"
      :title="`Neuen Code für ${renewTarget?.name} erzeugen?`"
      confirm="Neuen Code erzeugen"
      cancel="Abbrechen"
      @confirm="renew"
    >
      Der bisherige Code wird sofort ungültig. Handys, die damit angemeldet sind, werden abgemeldet
      und brauchen den neuen Code.
    </ConfirmDialog>

    <ConfirmDialog
      v-model:open="blockOpen"
      danger
      :title="`${blockTarget?.name} sperren?`"
      confirm="Sperren"
      cancel="Abbrechen"
      @confirm="setBlocked(blockTarget!, true)"
    >
      {{ blockTarget?.name }} kommt nicht mehr in App und Administration, angemeldete Handys werden
      abgemeldet. Die Erfassungen bleiben erhalten, die Sperre lässt sich wieder aufheben.
    </ConfirmDialog>
  </main>
</template>
