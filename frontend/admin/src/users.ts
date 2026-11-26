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
