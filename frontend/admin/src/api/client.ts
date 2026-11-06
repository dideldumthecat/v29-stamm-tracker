/**
 * The only module that talks to the server. A 401 or 403 on any request sends the user to the sign-in,
 * in this one place, unless the caller handles those itself (`silent`: the sign-in form and the router guard).
 */
export class ApiError extends Error {
  constructor(
    /** The HTTP status; 0 = no connection. */
    readonly status: number,
  ) {
    super(`API error ${status}`)
  }
}

let onUnauthorized: (() => void) | undefined

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

export async function request<T = void>(
  method: string,
  path: string,
  body?: unknown,
  { silent = false } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0)
  }
  if (!response.ok) {
    if (!silent && (response.status === 401 || response.status === 403)) onUnauthorized?.()
    throw new ApiError(response.status)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}
