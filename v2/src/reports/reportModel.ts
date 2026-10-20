import type { MonthModel, PayLine, PersonMonth } from '../admin/month/monthModel'
import { fmtDateYear } from '../admin/people/peopleModel'
import { fmtHours, initials } from '../format'
import { SHOP_NAME } from './shop'

/**
 * What the printed reports say, worked out from the same month model the Month screen uses, so a number on
 * paper is the number on screen. The attendance report and the statements are hours only: they get printed and
 * pinned up, so nothing in them may carry a salary, a pay figure or a payment (a test checks the finished PDFs for
 * the rupee sign). The owner copy of the attendance report is the one document that prices the hours.
 *
 * P present, H half day, A absent, F weekly holiday (paid), D weekly holiday the owner docked (not paid), O a session with no clock-out yet, '' nothing to show
 * (a day that has not happened, or before the person joined).
 */
export type DayCode = 'P' | 'H' | 'A' | 'F' | 'D' | 'O' | ''

export interface ReportCell {
  day: number
  code: DayCode
  /** Hours worked that day, each punch counted to the nearest quarter hour, overtime not included. */
  hours: number | null
}

const MONTH_NAME = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const weekdayOf = (ym: string, day: number) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, day).getDay()

const CODE: Record<string, DayCode> = { worked: 'P', half: 'H', absent: 'A', holiday: 'F', open: 'O', none: '' }

function cellsOf(p: PersonMonth): ReportCell[] {
  return p.days.map((d) => ({
    day: d.day,
    code: d.kind === 'holiday' && d.docked ? 'D' : (CODE[d.kind] ?? ''),
    // paidHours folds overtime in; the printed day is the worked time alone, the same split Month · Pay uses.
    hours: d.kind === 'worked' || d.kind === 'half' ? (d.paidHours ?? 0) - d.overtime : null,
  }))
}

/** The hours a person worked from their punches: Month · Pay's "Hours worked". */
const workedHours = (p: PersonMonth) => p.paidTotal - p.overtimeTotal

/** What the owner-copy cards add to a person's hours: the same hours, priced at their own hourly rate. */
export interface PayFigures {
  monthly: number | null
  perHour: number | null
  /** Worked, Fridays, Overtime: each part at the hourly rate, to the rupee, adding up to `salary`. */
  parts: [number, number, number] | null
  /** Month · Pay's figure for this person, to the rupee. null when no rate is in force. */
  salary: number | null
}

export interface PersonCard {
  name: string
  initials: string
  cells: ReportCell[]
  hours: { worked: number; fridays: number; overtime: number; total: number }
  /** Only on the owner copy. The shareable report is built without it, so a rupee cannot reach it by accident. */
  pay: PayFigures | null
}

export interface CardReport {
  shop: string
  monthLabel: string
  daysInMonth: number
  /** Monday-first: blanks before the 1st. */
  leadBlanks: number
  people: PersonCard[]
  totals: { hours: PersonCard['hours']; pay: { parts: [number, number, number]; salary: number; unrated: number } | null }
  hasOpen: boolean
  ownerCopy: boolean
  preparedAt: Date
}

/**
 * Each part at the hourly rate, rounded to the rupee, with the odd rupee that rounding leaves put on the largest part so
 * the three always add up to Month · Pay's own figure (the pay is rounded once, from the total hours).
 */
export function payFigures(line: PayLine): PayFigures {
  const monthly = line.rate?.monthly ?? null
  if (line.hourly === null || line.pay === null) return { monthly, perHour: null, parts: null, salary: null }
  const salary = Math.round(line.pay)
  const parts = [line.punchedHours, line.creditedHours, line.overtime].map((h) => Math.round((line.hourly as number) * h)) as [number, number, number]
  parts[parts.indexOf(Math.max(...parts))] += salary - parts.reduce((a, b) => a + b, 0)
  return { monthly, perHour: line.hourly, parts, salary }
}

export function buildCardReport(model: MonthModel, lines: PayLine[], now: Date, opts: { ownerCopy: boolean }): CardReport {
  const people: PersonCard[] = model.people.map((p) => {
    const line = lines.find((l) => l.emp.id === p.emp.id) as PayLine
    return {
      name: p.emp.name,
      initials: initials(p.emp.name),
      cells: cellsOf(p),
      // Exactly Month · Pay's hours lines: what the paid hours are made of.
      hours: { worked: line.punchedHours, fridays: line.creditedHours, overtime: line.overtime, total: line.paidHours },
      pay: opts.ownerCopy ? payFigures(line) : null,
    }
  })
  const sum = (f: (c: PersonCard) => number) => people.reduce((s, c) => s + f(c), 0)
  const priced = people.filter((c) => c.pay?.parts)
  return {
    shop: SHOP_NAME,
    monthLabel: MONTH_NAME(model.ym),
    daysInMonth: model.daysInMonth,
    leadBlanks: (weekdayOf(model.ym, 1) + 6) % 7,
    people,
    totals: {
      hours: { worked: sum((c) => c.hours.worked), fridays: sum((c) => c.hours.fridays), overtime: sum((c) => c.hours.overtime), total: sum((c) => c.hours.total) },
      pay: opts.ownerCopy
        ? {
            parts: [0, 1, 2].map((i) => priced.reduce((s, c) => s + (c.pay?.parts?.[i] ?? 0), 0)) as [number, number, number],
            salary: priced.reduce((s, c) => s + (c.pay?.salary ?? 0), 0),
            unrated: people.length - priced.length,
          }
        : null,
    },
    hasOpen: model.people.some((p) => p.days.some((d) => d.kind === 'open')),
    ownerCopy: opts.ownerCopy,
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
