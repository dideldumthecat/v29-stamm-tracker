import { describe, it, expect } from 'vitest'
import { formatDateTime } from '../utils/date'

describe('formatDateTime', () => {
  it('shows day, month, year and 24-hour local time', () => {
    const local = new Date(2026, 9, 2, 8, 5).toISOString()
    expect(formatDateTime(local)).toBe('02.10.2026, 08:05')
    expect(formatDateTime(new Date(2026, 9, 2, 18, 42).toISOString())).toBe('02.10.2026, 18:42')
    expect(formatDateTime(new Date(2026, 9, 2, 0, 7).toISOString())).toBe('02.10.2026, 00:07')
  })
})
