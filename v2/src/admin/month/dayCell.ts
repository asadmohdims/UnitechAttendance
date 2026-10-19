import { WEEKLY_HOLIDAY_DAY } from '@legacy/config.js'
import type { MonthDay } from './monthModel'

export type DayBase = 'full' | 'half' | 'absent' | 'holiday' | 'future'

/** The design shows a future weekly holiday as a paid "F" too, since the weekday alone says so. */
export const isFutureHoliday = (d: MonthDay) => d.kind === 'none' && d.isFuture && new Date(`${d.date}T12:00:00`).getDay() === WEEKLY_HOLIDAY_DAY

/** Which of the design's day colours a day takes. Shared by the one-person calendar and the team grid so they cannot differ. */
export function dayBase(d: MonthDay): DayBase {
  if (d.kind === 'worked') return 'full'
  if (d.kind === 'half') return 'half'
  if (d.kind === 'absent') return 'absent'
  if (d.kind === 'holiday' || isFutureHoliday(d)) return 'holiday'
  if (d.kind === 'open') return d.isToday ? 'full' : 'half'
  return 'future'
}

/** What a day's cell says: paid hours, a letter, or nothing. */
export const dayText = (d: MonthDay) => d.text || (isFutureHoliday(d) ? 'F' : '')
