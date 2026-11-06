import { ref } from 'vue'
import type { AdminMeResponse } from '@v29/shared/contract'

import { ApiError, request } from '@/api/client'

/** The signed-in user, kept in memory only: the cookie decides, so every page load asks the server once. */
export const user = ref<AdminMeResponse['user'] | null>(null)

const me = () => request<AdminMeResponse>('GET', 'admin/me', undefined, { silent: true })

/** @returns false if there is no valid sign-in (401) or no access to the administration (403) */
export async function loadUser(): Promise<boolean> {
  if (user.value) return true
  try {
    user.value = (await me()).user
    return true
  } catch (failure) {
    if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403))
      return false
    throw failure
  }
}

/** Redeems the invite code, then checks the role. Throws the ApiError of the failing step. */
export async function signIn(code: string) {
  await request('POST', 'session', { token: code }, { silent: true })
  user.value = (await me()).user
}

export async function signOut() {
  await request('DELETE', 'session', undefined, { silent: true })
  user.value = null
}
