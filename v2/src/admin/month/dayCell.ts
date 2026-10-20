import { WEEKLY_HOLIDAY_DAY } from '@legacy/config.js'
import { fmtHours } from '../../format'
import type { MonthDay } from './monthModel'

export type DayBase = 'full' | 'half' | 'absent' | 'holiday' | 'future'

/** The design shows a future weekly holiday as a paid "F" too, since the weekday alone says so. */
export const isFutureHoliday = (d: MonthDay) => d.kind === 'none' && d.isFuture && new Date(`${d.date}T12:00:00`).getDay() === WEEKLY_HOLIDAY_DAY

/** Which of the design's day colours a day takes. Shared by the one-person calendar and the team grid so they cannot differ. */
export function dayBase(d: MonthDay): DayBase {
  if (cameInOnHoliday(d)) return 'holiday'
  if (d.kind === 'worked') return 'full'
  if (d.kind === 'half') return 'half'
  if (d.kind === 'absent') return 'absent'
  if (d.kind === 'holiday' || isFutureHoliday(d)) return 'holiday'
  if (d.kind === 'open') return d.isToday ? 'full' : 'half'
  return 'future'
}

/** Someone worked on a Friday or a declared holiday the owner has not taken them off: the day is the standard day plus their hours. */
export const cameInOnHoliday = (d: MonthDay) => !!d.credit && !d.docked && (d.kind === 'worked' || d.kind === 'half') && d.paidHours !== null

/** What a day's cell says: paid hours, a letter ("PH": a declared holiday), "+2:00" for hours worked on a holiday, or nothing. */
export const dayText = (d: MonthDay) => (cameInOnHoliday(d) ? `+${fmtHours(d.paidHours as number)}` : d.text || (isFutureHoliday(d) ? 'F' : ''))
