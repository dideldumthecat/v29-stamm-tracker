import type { AdminUser, UserRole } from '@/api/contract'

import { formatDate } from '@/activity'

/** The roles as the page names them. */
export const ROLE_LABELS: Record<UserRole, string> = {
  user: 'Nutzer',
  admin: 'Admin',
  superadmin: 'Superadmin',
}
export const isBlocked = (user: AdminUser) => user.revoked_at !== null

export const lastActiveText = (user: AdminUser) =>
  user.last_active_at ? formatDate(user.last_active_at) : 'noch nicht'

/** What is typed in the card of a user; name, role and group are saved together with "Speichern". */
export type UserDraft = { name: string; role: 'user' | 'admin'; groupId: string }

export const newDraft = (): UserDraft => ({ name: '', role: 'user', groupId: '' })

export const draftOf = (user: AdminUser): UserDraft => ({
  name: user.name,
  role: user.role === 'admin' ? 'admin' : 'user',
  groupId: user.group_id,
})

export const isChanged = (user: AdminUser, draft: UserDraft) =>
  draft.name.trim() !== user.name ||
  draft.groupId !== user.group_id ||
  (user.can_set_role && draft.role !== user.role)

/** Only what differs goes to the server. */
export function bodyOf(user: AdminUser, draft: UserDraft) {
  const body: { name?: string; role?: string; group_id?: string } = {}
  if (draft.name.trim() !== user.name) body.name = draft.name
  if (draft.groupId !== user.group_id) body.group_id = draft.groupId
  if (user.can_set_role && draft.role !== user.role) body.role = draft.role
  return body
}
