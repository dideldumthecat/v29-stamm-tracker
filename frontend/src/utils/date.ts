/** Short German date without year, as used in the field metadata: "02.10." */
export function formatShortDate(isoDate: string): string {
  const date = new Date(isoDate)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.`
}

/** Contract date "2026-09-28" → "28.09.2026", the way V29 writes dates. */
export function formatDate(calendarDate: string): string {
  return calendarDate.split('-').reverse().join('.')
}

/** Contract month "2026-10" → "10/2026", the way V29 writes it. */
export function formatMonth(calendarMonth: string): string {
  return calendarMonth.split('-').reverse().join('/')
}
