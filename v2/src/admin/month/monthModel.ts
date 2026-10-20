import { ownerPunches } from '@legacy/dayStatus.js'
import { creditFor, declaredHolidays, type CreditKind } from '../holidays'
import { isConfirmedOnly } from '../review'
import { buildDayHours, dayOffStatus, groupByEmployeeDay, isHalfDay, isPossibleMissedLunch, needsReview } from '@legacy/reportMath.js'
import { recHoursRounded } from '@legacy/rounding.js'
import { STANDARD_DAY_HOURS } from '@legacy/config.js'
import { calcSalary, periodEndDate, pickRateForPeriod } from '@legacy/salary.js'
import type { DayPayOverride, Employee, OvertimeRow, RecordRow } from '../../data/types'
import { dateKey, fmtHours } from '../../format'

/**
 * What one day is for one person. Ported from js/ui/report.js (`monthData` + `pillInfo`) so the
 * rules are the live app's, and so Attendance and Pay read the same numbers.
 *
 * - `open`: a session is still open (no final number).
 * - `half` / `worked`: has hours; half = one short session (`isHalfDay`).
 * - `holiday` / `absent`: no punches at all, past, after the person was added. `holiday` is a standard day paid
 *   without punches: the weekly Friday, or a holiday the owner declared (`credit` says which). A person who does
 *   punch on such a day keeps their `worked` / `half` kind and carries the same `credit`.
 * - `none`: nothing to show (a day that has not happened, or predates the person).
 */
export type DayKind = 'worked' | 'half' | 'absent' | 'holiday' | 'open' | 'none'

export interface MonthDay {
  day: number
  date: string
  kind: DayKind
  isToday: boolean
  isFuture: boolean
  /** The cell's text: paid hours, "F", "A", "!" (still open), "In" (open today). */
  text: string
  /** Exact punch hours; null when there are no completed punches. */
  exactHours: number | null
  /** Paid hours (quarter-hour rounding) with that day's overtime folded in. */
  paidHours: number | null
  overtime: number
  sessions: RecordRow[]
  /** Closed with no clock-out photo and not yet resolved by the owner: hours known, needs a look. */
  flagged: boolean
  /** The owner set a punch on this day and it no longer needs review: shown with a tick. */
  reviewed: boolean
  /** An earlier session was closed with no photo and a later punch followed. */
  autoInfo: boolean
  /** One closed session of a full day's length: a lunch punch may be missing. */
  unbroken: boolean
  /** A paid Friday the owner marked unpaid. */
  docked: boolean
  /** The standard day this date earns whatever the punches (docked or not), or null on an ordinary day. */
  credit: CreditKind | null
}

export interface PersonMonth {
  emp: Employee
  days: MonthDay[]
  /** Exact hours plus overtime: the "Total hrs" figure. */
  exactTotal: number
  /** Paid hours (rounded punches plus overtime): what Pay is based on. */
  paidTotal: number
  overtimeTotal: number
  daysWorked: number
  /** Days that count toward "of N so far": worked, half, still open, or absent. Paid holidays are not in it. */
  expectedDays: number
  daysOff: number
  halfDays: number
  /** Full absences plus half a day per half day. */
  absentEq: number
  needsReview: boolean
  /** Weekly-holiday days in the month (docked or not), including ones the person came in on. */
  holidays: number
  docked: number
  /** Holidays the owner declared (docked or not), including ones the person came in on. */
  declared: number
  declaredDocked: number
}

export interface MonthModel {
  ym: string
  daysInMonth: number
  /** Days of the month that have started, up to and including today. */
  daysElapsed: number
  people: PersonMonth[]
  /** The dates this month the owner declared a paid holiday. */
  declaredHolidays: string[]
  /** The last session of every day that needs review, in encounter order. */
  reviewRecords: RecordRow[]
  hasData: boolean
  totals: { hours: number; daysWorked: number; expectedDays: number; absences: number; halfDays: number }
}

interface Args {
  ym: string
  employees: Employee[]
  records: RecordRow[]
  overrides: DayPayOverride[]
  overtime: OvertimeRow[]
  today: string
}

const pad = (n: number) => String(n).padStart(2, '0')

export function buildMonthModel({ ym, employees, records, overrides, overtime, today }: Args): MonthModel {
  const [y, m] = ym.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const people = employees.filter((e) => e.active || records.some((r) => r.emp_id === e.id))
  const ids = people.map((e) => e.id)

  const { hours, openFlags } = buildDayHours(records, ids, daysInMonth) as unknown as { hours: Record<string, (number | null)[]>; openFlags: Record<string, boolean[]> }
  const { hours: payHours } = buildDayHours(records, ids, daysInMonth, recHoursRounded) as unknown as { hours: Record<string, (number | null)[]> }
  const sessionsByDay = groupByEmployeeDay(records) as Record<string, Record<number, RecordRow[]>>

  const overtimeBy: Record<string, number[]> = {}
  for (const id of ids) overtimeBy[id] = Array(daysInMonth + 1).fill(0)
  for (const o of overtime) {
    const d = Number(o.date.slice(8, 10))
    if (overtimeBy[o.emp_id]) overtimeBy[o.emp_id][d] = Number(o.hours)
  }
  const declared = declaredHolidays(overrides)
  const paidBy = new Map(overrides.map((o) => [`${o.emp_id}:${o.date}`, o.paid]))

  const reviewRecords: RecordRow[] = []
  const reviewDays = new Set<string>()
  for (const [empId, byDay] of Object.entries(sessionsByDay)) {
    for (const [day, sessions] of Object.entries(byDay)) {
      if (!needsReview(sessions)) continue
      reviewRecords.push(sessions[sessions.length - 1])
      reviewDays.add(`${empId}:${day}`)
    }
  }

  const todayDay = today.startsWith(ym) ? Number(today.slice(8, 10)) : today > `${ym}-31` ? daysInMonth : 0

  let totalHours = 0, daysWorkedAll = 0, expected = 0, absences = 0, halfAll = 0
  const result: PersonMonth[] = people.map((emp) => {
    const since = emp.created_at ? dateKey(new Date(emp.created_at)) : undefined
    const days: MonthDay[] = []
    let exact = 0, paid = 0, worked = 0, expectedPerson = 0, off = 0, half = 0, holidays = 0, dockedCount = 0, declaredCount = 0, declaredDockedCount = 0, otTotal = 0, anyReview = false

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${pad(d)}`
      const sessions = sessionsByDay[emp.id]?.[d] ?? []
      const open = openFlags[emp.id][d]
      const exactHours = hours[emp.id][d]
      const hasHours = exactHours !== null
      const ot = overtimeBy[emp.id][d]
      // Overtime is paid time on a day that already has hours; a day with no punches keeps its letter.
      const paidHours = payHours[emp.id][d] === null ? null : (payHours[emp.id][d] as number) + ot
      const flagged = reviewDays.has(`${emp.id}:${d}`) && !open
      const reviewed = !flagged && !open && sessions.some((x) => { const o = ownerPunches(x) as { in: boolean; out: boolean; added: boolean }; return o.in || o.out || o.added || isConfirmedOnly(x) })
      const autoInfo = !flagged && sessions.some((s) => s.clock_out && !s.out_photo)
      const weekday = new Date(y, m - 1, d).getDay()
      const credit = creditFor({ date, weekday, since, today, declared, paid: paidBy.get(`${emp.id}:${date}`) })
      // A day with no punches: a paid standard day if it has a credit, else an absence (or nothing yet).
      const gap = !open && !hasHours ? (credit ? 'holiday' : (dayOffStatus({ date, weekday, employeeSince: since, today }) as 'off' | null)) : null
      // A short visit on a paid holiday is not a half day: the person was not expected, and the 8:00 is paid anyway.
      const onHoliday = !!credit && !credit.docked
      const isHalf = hasHours && !onHoliday && isHalfDay(sessions, exactHours)
      const unbroken = hasHours && !isHalf && isPossibleMissedLunch(sessions, exactHours)
      const docked = credit?.docked ?? false

      const kind: DayKind = open ? 'open' : hasHours ? (isHalf ? 'half' : 'worked') : gap === 'holiday' ? 'holiday' : gap === 'off' ? 'absent' : 'none'
      const isToday = date === today
      const text = open ? (isToday ? 'In' : '!') : hasHours ? fmtHours(paidHours as number) : gap === 'holiday' ? (credit?.kind === 'holiday' ? 'PH' : 'F') : gap === 'off' ? 'A' : ''

      if (hasHours) { exact += exactHours as number; worked++; paid += paidHours as number }
      otTotal += ot
      if (gap === 'off') off++
      if (isHalf) half++
      if (credit?.kind === 'friday') { holidays++; if (docked) dockedCount++ }
      if (credit?.kind === 'holiday') { declaredCount++; if (docked) declaredDockedCount++ }
      if (flagged || open) anyReview = true
      if (kind === 'worked' || kind === 'half' || kind === 'open' || kind === 'absent') { expected++; expectedPerson++ }

      days.push({ day: d, date, kind, isToday, isFuture: date > today, text, exactHours, paidHours, overtime: ot, sessions, flagged, reviewed, autoInfo, unbroken, docked, credit: credit?.kind ?? null })
    }

    const exactTotal = exact + otTotal
    totalHours += exactTotal
    daysWorkedAll += worked
    absences += off
    halfAll += half
    return {
      emp, days, exactTotal, paidTotal: paid, overtimeTotal: otTotal, daysWorked: worked, expectedDays: expectedPerson, daysOff: off, halfDays: half,
      absentEq: off + half * 0.5, needsReview: anyReview, holidays, docked: dockedCount, declared: declaredCount, declaredDocked: declaredDockedCount,
    }
  })

  return {
    ym, daysInMonth, daysElapsed: todayDay, people: result, declaredHolidays: [...declared].filter((d) => d.startsWith(ym)).sort(), reviewRecords, hasData: records.length > 0,
    totals: { hours: totalHours, daysWorked: daysWorkedAll, expectedDays: expected, absences, halfDays: halfAll },
  }
}

export interface PayLine {
  emp: Employee
  /** null when no rate is in force for this month. */
  rate: { monthly: number; from: string } | null
  standardHours: number
  hourly: number | null
  /** Hours the pay is based on: rounded punches + overtime + credited paid Fridays + credited paid holidays. */
  paidHours: number
  punchedHours: number
  overtime: number
  /** Paid Fridays x a standard day. */
  creditedHours: number
  paidFridays: number
  dockedFridays: number
  totalFridays: number
  /** Declared holidays x a standard day. */
  holidayHours: number
  paidHolidays: number
  dockedHolidays: number
  totalHolidays: number
  daysWorked: number
  pay: number | null
}

export interface RateRow { monthly_salary: number; effective_from: string; created_at?: string }

/**
 * Pay for the month, the calendar-day way (js/ui/salary.js): standard hours are this month's real
 * day count x the standard day, and each paid Friday or declared holiday is credited a standard day
 * whatever the punches, so a holiday costs nothing and working one pays the hours on top. A docked
 * one is simply not credited.
 */
export function buildPayLines(model: MonthModel, ratesByEmp: Record<string, RateRow[]>, today: string): PayLine[] {
  const periodEnd = periodEndDate(model.ym, today) as string
  const standardHours = model.daysInMonth * STANDARD_DAY_HOURS
  return model.people.map((p) => {
    const paidFridays = p.holidays - p.docked
    const creditedHours = paidFridays * STANDARD_DAY_HOURS
    const paidHolidays = p.declared - p.declaredDocked
    const holidayHours = paidHolidays * STANDARD_DAY_HOURS
    const paidHours = p.paidTotal + creditedHours + holidayHours
    const rate = pickRateForPeriod(ratesByEmp[p.emp.id] ?? [], periodEnd) as RateRow | null
    const calc = rate ? (calcSalary({ monthlySalary: rate.monthly_salary, hoursWorked: paidHours, standardHours }) as { amount: number }) : null
    return {
      emp: p.emp,
      rate: rate ? { monthly: rate.monthly_salary, from: rate.effective_from } : null,
      standardHours,
      hourly: rate ? rate.monthly_salary / standardHours : null,
      paidHours,
      punchedHours: p.paidTotal - p.overtimeTotal,
      overtime: p.overtimeTotal,
      creditedHours,
      paidFridays,
      dockedFridays: p.docked,
      totalFridays: p.holidays,
      holidayHours,
      paidHolidays,
      dockedHolidays: p.declaredDocked,
      totalHolidays: p.declared,
      daysWorked: p.daysWorked,
      pay: calc ? calc.amount : null,
    }
  })
}

export interface MonthStats {
  hours: number
  daysWorked: number
  expectedDays: number
  absences: number
  halfDays: number
}

/** The four Attendance tiles' figures: the whole team, or one person's. The team's are exactly what the model already totals. */
export function statsFor(model: MonthModel, person: PersonMonth | null): MonthStats {
  if (!person) return { hours: model.totals.hours, daysWorked: model.totals.daysWorked, expectedDays: model.totals.expectedDays, absences: model.totals.absences, halfDays: model.totals.halfDays }
  return { hours: person.exactTotal, daysWorked: person.daysWorked, expectedDays: person.expectedDays, absences: person.daysOff, halfDays: person.halfDays }
}
