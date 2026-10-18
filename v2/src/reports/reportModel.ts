import type { MonthModel, PayLine, PersonMonth } from '../admin/month/monthModel'
import { fmtDateYear } from '../admin/people/peopleModel'
import { fmtHours, initials } from '../format'
import { SHOP_NAME } from './shop'

/**
 * What the printed reports say, worked out from the same month model the Month screen uses, so a number on
 * paper is the number on screen. Hours only: these documents get printed and pinned up, so nothing here may
 * carry a salary, a pay figure or a payment (a test checks the finished PDFs for the rupee sign).
 *
 * P present, H half day, A absent, F weekly holiday (paid), O a session with no clock-out yet, '' nothing to show
 * (a day that has not happened, or before the person joined).
 */
export type DayCode = 'P' | 'H' | 'A' | 'F' | 'O' | ''

export interface ReportCell {
  day: number
  code: DayCode
  /** Hours worked that day, each punch counted to the nearest quarter hour, overtime not included. */
  hours: number | null
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAME = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const weekdayOf = (ym: string, day: number) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, day).getDay()

const CODE: Record<string, DayCode> = { worked: 'P', half: 'H', absent: 'A', holiday: 'F', open: 'O', none: '' }

function cellsOf(p: PersonMonth): ReportCell[] {
  return p.days.map((d) => ({
    day: d.day,
    code: CODE[d.kind] ?? '',
    // paidHours folds overtime in; the printed day is the worked time alone, the same split Month · Pay uses.
    hours: d.kind === 'worked' || d.kind === 'half' ? (d.paidHours ?? 0) - d.overtime : null,
  }))
}

/** The hours a person worked from their punches: Month · Pay's "Hours worked". */
const workedHours = (p: PersonMonth) => p.paidTotal - p.overtimeTotal

export interface AttendanceReport {
  shop: string
  monthLabel: string
  daysInMonth: number
  heads: { n: number; weekday: string; friday: boolean }[]
  rows: { name: string; cells: ReportCell[]; daysWorked: number; absent: number; hours: number }[]
  totals: { hours: number; daysWorked: number; absent: number; halfDays: number }
  /** True when any day is still open, so the legend can explain the "?" cell. */
  hasOpen: boolean
  preparedAt: Date
}

export function buildAttendanceReport(model: MonthModel, now: Date): AttendanceReport {
  const rows = model.people.map((p) => ({ name: p.emp.name, cells: cellsOf(p), daysWorked: p.daysWorked, absent: p.daysOff, hours: workedHours(p) }))
  return {
    shop: SHOP_NAME,
    monthLabel: MONTH_NAME(model.ym),
    daysInMonth: model.daysInMonth,
    heads: Array.from({ length: model.daysInMonth }, (_, i) => ({ n: i + 1, weekday: WEEKDAY[weekdayOf(model.ym, i + 1)], friday: weekdayOf(model.ym, i + 1) === 5 })),
    rows,
    totals: {
      hours: model.people.reduce((s, p) => s + workedHours(p), 0),
      daysWorked: model.people.reduce((s, p) => s + p.daysWorked, 0),
      absent: model.people.reduce((s, p) => s + p.daysOff, 0),
      halfDays: model.people.reduce((s, p) => s + p.halfDays, 0),
    },
    hasOpen: model.people.some((p) => p.days.some((d) => d.kind === 'open')),
    preparedAt: now,
  }
}

export interface Statement {
  shop: string
  monthLabel: string
  rangeLabel: string
  name: string
  initials: string
  since: string | null
  tiles: { daysWorked: number; absent: number; halfDays: number; hoursWorked: number }
  /** Monday-first: blanks before the 1st, then every day. */
  leadBlanks: number
  cells: ReportCell[]
  hasOpen: boolean
  counted: { worked: number; paidFridays: number; fridayHours: number; overtime: number; total: number }
  preparedAt: Date
}

export function buildStatement(model: MonthModel, person: PersonMonth, line: PayLine, now: Date): Statement {
  const first = weekdayOf(model.ym, 1) // 0 = Sunday
  const monthName = new Date(Number(model.ym.slice(0, 4)), Number(model.ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long' })
  return {
    shop: SHOP_NAME,
    monthLabel: MONTH_NAME(model.ym),
    rangeLabel: `1 to ${model.daysInMonth} ${monthName}`,
    name: person.emp.name,
    initials: initials(person.emp.name),
    since: person.emp.created_at ? fmtDateYear(person.emp.created_at.slice(0, 10)) : null,
    tiles: { daysWorked: person.daysWorked, absent: person.daysOff, halfDays: person.halfDays, hoursWorked: workedHours(person) },
    leadBlanks: (first + 6) % 7,
    cells: cellsOf(person),
    hasOpen: person.days.some((d) => d.kind === 'open'),
    // Exactly Month · Pay's hours lines, hours only: what the paid hours are made of.
    counted: { worked: line.punchedHours, paidFridays: line.paidFridays, fridayHours: line.creditedHours, overtime: line.overtime, total: line.paidHours },
    preparedAt: now,
  }
}

/** "8", "7.75", "8.25": hours in the grid cells, no trailing zeros. */
export const cellHours = (h: number) => String(Math.round(h * 100) / 100)
export { fmtHours }

/** "1 Oct 2026, 9:12 AM" */
export function fmtPrepared(d: Date): string {
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/am|pm/i, (x) => x.toUpperCase())
  return `${date}, ${time}`
}
