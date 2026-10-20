import { dayOffStatus } from '@legacy/reportMath.js'
import { WEEKLY_HOLIDAY_DAY } from '@legacy/config.js'
import type { DayPayOverride } from '../data/types'

/**
 * Paid days that need no punches: the weekly holiday (Friday) and a holiday the owner declares for a date.
 * Either one pays a standard day (8:00) to everyone who was on the roster, and anyone who comes in is paid their
 * hours on top, so working a holiday never pays less than staying home.
 *
 * A declared holiday is stored in `day_pay_overrides`, the table that already holds "this Friday is unpaid for
 * this person": a `paid: true` row on a date that is not a Friday means "this date is a paid holiday", and a
 * `paid: false` row on such a date, or on a Friday, takes that one person off it. No new table, and the shared
 * store is untouched. The table has no room for a name, so a holiday has none. A `paid: true` row on a Friday is
 * just "restore as paid" and is not a holiday, so it never counts as one.
 */
export type CreditKind = 'friday' | 'holiday'

export interface DayCredit {
  kind: CreditKind
  /** The owner took this person off it: no standard day is paid (hours worked still are). */
  docked: boolean
}

const isFriday = (date: string) => new Date(`${date}T12:00:00`).getDay() === WEEKLY_HOLIDAY_DAY

/** The dates in these overrides that are declared paid holidays. */
export function declaredHolidays(overrides: DayPayOverride[]): Set<string> {
  return new Set(overrides.filter((o) => o.paid === true && !isFriday(o.date)).map((o) => o.date))
}

export interface CreditArgs {
  date: string
  weekday: number
  /** The person's start date, when known (a day before it earns nothing). */
  since: string | undefined
  today: string
  declared: Set<string>
  /** The person's own override row for this date: false = taken off it. */
  paid: boolean | undefined
}

/** What a day is worth to a person with no punches at all: null, or a standard day (docked or not). */
export function creditFor({ date, weekday, since, today, declared, paid }: CreditArgs): DayCredit | null {
  const status = dayOffStatus({ date, weekday, employeeSince: since, today }) as 'holiday' | 'off' | null
  if (status === null) return null // the day has not happened, or predates the person
  const kind: CreditKind | null = declared.has(date) ? 'holiday' : status === 'holiday' ? 'friday' : null
  return kind ? { kind, docked: paid === false } : null
}
