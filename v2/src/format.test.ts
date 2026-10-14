import { describe, expect, it } from 'vitest'
import { dateKey, fmtDateLong, fmtHours, fmtTime, initials } from './format'

describe('format', () => {
  it('writes times in 12-hour AM/PM, uppercase', () => {
    expect(fmtTime(new Date(2026, 9, 13, 14, 12))).toBe('2:12 PM')
    expect(fmtTime(new Date(2026, 9, 13, 9, 3))).toBe('9:03 AM')
  })
  it('writes durations as h:mm', () => {
    expect(fmtHours(4 + 2 / 60)).toBe('4:02')
    expect(fmtHours(0)).toBe('0:00')
  })
  it('writes the long date as weekday, day month', () => {
    expect(fmtDateLong(new Date(2026, 9, 13))).toBe('Tuesday, 13 October')
  })
  it('writes the record date key in local time', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
  it('takes up to two initials', () => {
    expect(initials('Mohammed Asad Khan')).toBe('MA')
    expect(initials('  raju ')).toBe('R')
    expect(initials('')).toBe('?')
  })
})
