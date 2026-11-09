/** Short German date without year, as used in the field metadata: "02.10." */
export function formatShortDate(isoDate: string): string {
  const date = new Date(isoDate)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.`
}

/** Short German date and time without year: "15.10., 18:42" */
export function formatShortDateTime(timestamp: string): string {
  const time = new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatShortDate(timestamp)}, ${time}`
}

/** Local date with year and time, 24 hours: "02.10.2026, 18:42" */
export function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}
