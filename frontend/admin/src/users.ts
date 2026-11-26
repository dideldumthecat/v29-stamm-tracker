import type { AdminUser, UserRole } from '@/api/contract'

import { formatDate } from '@/activity'
import { errorsOf } from '@/attributes'

/** The roles as the page names them. */
export const ROLE_LABELS: Record<UserRole, string> = {
  user: 'Nutzer',
  admin: 'Admin',
  superadmin: 'Superadmin',
}
export const isBlocked = (user: AdminUser) => user.revoked_at !== null

export const lastActiveText = (user: AdminUser) =>
  user.last_active_at ? formatDate(user.last_active_at) : 'noch nicht'

/** "field → message" of a 422 (the same shape as for the attributes). */
export const userErrorsOf = errorsOf

/** The text of the page for a count, "1 Nutzer" / "5 Nutzer". */
export const countUsers = (n: number) => `${n} Nutzer`
