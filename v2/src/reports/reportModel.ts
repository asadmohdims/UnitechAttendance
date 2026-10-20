import type { MonthModel, PayLine, PersonMonth } from '../admin/month/monthModel'
import { fmtDateYear } from '../admin/people/peopleModel'
import { fmtHours, initials } from '../format'
import { SHOP_NAME } from './shop'

/**
 * What the printed reports say, worked out from the same month model the Month screen uses, so a number on
 * paper is the number on screen. The employee statements are hours only: they get printed and pinned up, so nothing
 * in them may carry a salary, a pay figure or a payment (a test checks the finished PDF for the rupee sign).
 * The owner's attendance-and-pay cards are the one document that prices the hours.
 *
 * P present, H half day, A absent, F weekly holiday (paid), PH a holiday the owner declared (paid), D a holiday the owner docked
 * (not paid), O a session with no clock-out yet, '' nothing to show. F and PH with hours: the person came in, so the cell is the 8:00
 * plus those hours.
 * (a day that has not happened, or before the person joined).
 */
export type DayCode = 'P' | 'H' | 'A' | 'F' | 'PH' | 'D' | 'O' | ''

export interface ReportCell {
  day: number
  code: DayCode
  /** Hours worked that day, each punch counted to the nearest quarter hour, overtime not included. On F, PH and D: the hours worked on top. */
  hours: number | null
}

const MONTH_NAME = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const weekdayOf = (ym: string, day: number) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, day).getDay()

const CODE: Record<string, DayCode> = { worked: 'P', half: 'H', absent: 'A', holiday: 'F', open: 'O', none: '' }

/** A day that earns a standard day takes its holiday letter whether or not the person came in; a docked one is D. */
function codeOf(d: PersonMonth['days'][number]): DayCode {
  if (d.credit) {
    if (d.docked) return 'D'
    if (d.kind === 'holiday' || d.kind === 'worked' || d.kind === 'half') return d.credit === 'holiday' ? 'PH' : 'F'
  }
  return CODE[d.kind] ?? ''
}

function cellsOf(p: PersonMonth): ReportCell[] {
  return p.days.map((d) => ({
    day: d.day,
    code: codeOf(d),
    // paidHours folds overtime in; the printed day is the worked time alone, the same split Month · Pay uses.
    hours: d.kind === 'worked' || d.kind === 'half' ? (d.paidHours ?? 0) - d.overtime : null,
  }))
}

/** The hours a person worked from their punches: Month · Pay's "Hours worked". */
const workedHours = (p: PersonMonth) => p.paidTotal - p.overtimeTotal

/** What the cards add to a person's hours: the same hours, priced at their own hourly rate (which is not printed). */
export interface PayFigures {
  /** Worked, Fridays, Holidays, Overtime: each part at the hourly rate, to the rupee, adding up to `salary`. */
  parts: Parts | null
  /** Month · Pay's figure for this person, to the rupee. null when no rate is in force. */
  salary: number | null
}
export type Parts = [number, number, number, number]
export interface Hours { worked: number; fridays: number; holidays: number; overtime: number; total: number }

export interface PersonCard {
  name: string
  cells: ReportCell[]
  hours: Hours
  pay: PayFigures
}

export interface CardReport {
  shop: string
  monthLabel: string
  daysInMonth: number
  /** Monday-first: blanks before the 1st. */
  leadBlanks: number
  people: PersonCard[]
  totals: { hours: Hours; pay: { parts: Parts; salary: number; unrated: number } }
  /** Dates this month declared a paid holiday, as "2026-09-14". */
  holidayDates: string[]
  hasOpen: boolean
  preparedAt: Date
}

/**
 * Each part at the hourly rate, rounded to the rupee, with the odd rupee that rounding leaves put on the largest part so
 * the four always add up to Month · Pay's own figure (the pay is rounded once, from the total hours).
 */
export function payFigures(line: PayLine): PayFigures {
  if (line.hourly === null || line.pay === null) return { parts: null, salary: null }
  const salary = Math.round(line.pay)
  const parts = [line.punchedHours, line.creditedHours, line.holidayHours, line.overtime].map((h) => Math.round((line.hourly as number) * h)) as Parts
  parts[parts.indexOf(Math.max(...parts))] += salary - parts.reduce((a, b) => a + b, 0)
  return { parts, salary }
}

export function buildCardReport(model: MonthModel, lines: PayLine[], now: Date): CardReport {
  const people: PersonCard[] = model.people.map((p) => {
    const line = lines.find((l) => l.emp.id === p.emp.id) as PayLine
    return {
      name: p.emp.name,
      cells: cellsOf(p),
      // Exactly Month · Pay's hours lines: what the paid hours are made of.
      hours: { worked: line.punchedHours, fridays: line.creditedHours, holidays: line.holidayHours, overtime: line.overtime, total: line.paidHours },
      pay: payFigures(line),
    }
  })
  const sum = (f: (c: PersonCard) => number) => people.reduce((s, c) => s + f(c), 0)
  const priced = people.filter((c) => c.pay.parts)
  return {
    shop: SHOP_NAME,
    monthLabel: MONTH_NAME(model.ym),
    daysInMonth: model.daysInMonth,
    leadBlanks: (weekdayOf(model.ym, 1) + 6) % 7,
    people,
    totals: {
      hours: { worked: sum((c) => c.hours.worked), fridays: sum((c) => c.hours.fridays), holidays: sum((c) => c.hours.holidays), overtime: sum((c) => c.hours.overtime), total: sum((c) => c.hours.total) },
      pay: {
        parts: [0, 1, 2, 3].map((i) => priced.reduce((s, c) => s + (c.pay.parts?.[i] ?? 0), 0)) as Parts,
        salary: priced.reduce((s, c) => s + (c.pay.salary ?? 0), 0),
        unrated: people.length - priced.length,
      },
    },
    holidayDates: model.declaredHolidays,
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
  counted: { worked: number; paidFridays: number; fridayHours: number; paidHolidays: number; holidayHours: number; overtime: number; total: number }
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
    counted: { worked: line.punchedHours, paidFridays: line.paidFridays, fridayHours: line.creditedHours, paidHolidays: line.paidHolidays, holidayHours: line.holidayHours, overtime: line.overtime, total: line.paidHours },
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
