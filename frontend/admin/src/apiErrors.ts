/** "field → message" of a 422; the first message of a field counts. */
export function errorsOf(body: unknown): Record<string, string> {
  const list = (body as { errors?: { field: string; message: string }[] } | undefined)?.errors
  const errors: Record<string, string> = {}
  for (const { field, message } of Array.isArray(list) ? list : []) errors[field] ??= message
  return errors
}
