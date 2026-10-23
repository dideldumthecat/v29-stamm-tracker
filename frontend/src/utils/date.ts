/** Short German date without year, as used in the field metadata: "02.10." */
export function formatShortDate(isoDate: string): string {
  const date = new Date(isoDate)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.`
}

/**
 * Parses "TT.MM.JJJJ" (one-digit day/month allowed) into the contract format "YYYY-MM-DD".
 * Returns null for anything else, including impossible dates like 31.02.2026.
 */
export function parseDate(text: string): string | null {
  const match = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(text)
  if (!match) {
    return null
  }
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  // Round trip through Date: it rolls 31.02. over to March, so a mismatch means "impossible date".
  const check = new Date(year, month - 1, day)
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Contract date "2026-09-28" → "28.09.2026", the way V29 writes dates. */
export function formatDate(calendarDate: string): string {
  return calendarDate.split('-').reverse().join('.')
}
