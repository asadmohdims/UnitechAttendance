import { fmtCurrency, fmtRate } from '@legacy/salary.js'
import type { Payment } from '../data/types'
import type { PayLine, PersonMonth } from '../admin/month/monthModel'
import { buildSettlement, type SettlementStatus } from '../admin/month/payModel'
import type { Ledger } from '../admin/month/paymentsModel'
import { fmtHours } from '../format'
import { SHOP_NAME } from './shop'

/**
 * The owner's payroll summary, worked out from the same Pay lines and settlement the Month · Pay screen shows, so a
 * figure on paper is the figure on screen. Unlike the attendance report and the statements this one carries money: it
 * is stamped "Owner copy", and it is the only report that may (a test holds the other two to hours only).
 */
export interface PayrollRow {
  name: string
  salary: string
  days: string
  worked: string
  fridays: string
  overtime: string
  paidHours: string
  perHour: string
  pay: string
  paidOut: string
  /** The amount shown in the balance column, and the word under it. */
  balance: string
  balanceLabel: string
  tone: 'owing' | 'settled' | 'ahead' | 'unknown'
}

export interface PayrollSummary {
  shop: string
  monthLabel: string
  /** "240:00 here (30 days of 8 hours)": the hours a month's salary is spread over. */
  standardHoursText: string
  rows: PayrollRow[]
  totals: { salary: string; days: string; worked: string; fridays: string; overtime: string; paidHours: string; pay: string; paidOut: string; toPay: string }
  /** What needs the owner's eye before this is relied on; empty when nothing does. */
  notes: string[]
  preparedAt: Date
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

interface Inputs {
  monthLabel: string
  daysInMonth: number
  standardDayHours: number
  people: PersonMonth[]
  lines: PayLine[]
  /** null when the payments read failed: paid out and balance are then unknown, not nil. */
  payments: Payment[] | null
  ledger: Ledger | null
  /** Days still to check, by person (the Days queue): pay on those days could still change. */
  checkDates: Record<string, string[]>
  now: Date
}

export function buildPayrollSummary(i: Inputs): PayrollSummary {
  const settlement = buildSettlement(i.lines, i.people, i.payments)
  const tone = (s: SettlementStatus): PayrollRow['tone'] => (s === 'to-pay' ? 'owing' : s === 'settled' ? 'settled' : s === 'ahead' ? 'ahead' : 'unknown')

  const rows: PayrollRow[] = settlement.rows.map((r) => {
    const l = r.line
    const left = r.left
    return {
      name: l.emp.name,
      salary: l.rate ? fmtCurrency(l.rate.monthly) : 'No rate',
      days: String(l.daysWorked),
      worked: fmtHours(l.punchedHours),
      fridays: l.creditedHours ? fmtHours(l.creditedHours) : '',
      overtime: l.overtime ? fmtHours(l.overtime) : '',
      paidHours: fmtHours(l.paidHours),
      perHour: fmtRate(l.hourly) as string,
      pay: r.pay === null ? '—' : fmtCurrency(r.pay),
      paidOut: r.paidOut === null ? '—' : fmtCurrency(r.paidOut),
      balance: left === null ? '—' : left === 0 ? fmtCurrency(0) : fmtCurrency(Math.abs(left)),
      balanceLabel: r.status === 'to-pay' ? 'to pay' : r.status === 'settled' ? 'settled' : r.status === 'ahead' ? 'paid ahead' : r.status === 'no-rate' ? 'no rate set' : 'not known',
      tone: tone(r.status),
    }
  })

  const sum = (f: (l: PayLine) => number) => i.lines.reduce((s, l) => s + f(l), 0)
  const totals = {
    salary: fmtCurrency(sum((l) => l.rate?.monthly ?? 0)),
    days: String(sum((l) => l.daysWorked)),
    worked: fmtHours(sum((l) => l.punchedHours)),
    fridays: fmtHours(sum((l) => l.creditedHours)),
    overtime: fmtHours(sum((l) => l.overtime)),
    paidHours: fmtHours(sum((l) => l.paidHours)),
    pay: fmtCurrency(settlement.earned),
    paidOut: settlement.paidOut === null ? '—' : fmtCurrency(settlement.paidOut),
    toPay: settlement.toPay === null ? '—' : fmtCurrency(settlement.toPay),
  }

  const notes: string[] = []
  if (i.payments === null) notes.push('Payments could not be read, so Paid out and Balance are blank. Download again once they load.')
  const ahead = settlement.rows.filter((r) => r.status === 'ahead')
  for (const r of ahead) notes.push(`${r.line.emp.name} has been paid ${fmtCurrency(-(r.left as number))} more than this month's pay.`)
  const noRate = settlement.rows.filter((r) => r.status === 'no-rate').map((r) => r.line.emp.name)
  if (noRate.length) notes.push(`${joinNames(noRate)} ${noRate.length === 1 ? 'has' : 'have'} no salary set for this month, so no pay is shown.`)
  const check = Object.entries(i.checkDates).filter(([, d]) => d.length)
  if (check.length) {
    const total = check.reduce((s, [, d]) => s + d.length, 0)
    const who = check.map(([id, d]) => `${i.people.find((p) => p.emp.id === id)?.emp.name ?? 'Someone'}, ${d.map((x) => new Date(`${x}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(' and ')}`)
    notes.push(`${plural(total, 'day')} in Attendance still ${total === 1 ? 'needs' : 'need'} a look (${who.join('; ')}). Hours, and so pay, may change.`)
  }
  const mm = i.ledger?.mismatches ?? 0
  if (mm && i.ledger?.firstMismatch) {
    const f = i.ledger.firstMismatch
    const name = i.people.find((p) => p.emp.id === f.empId)?.emp.name ?? 'Someone'
    notes.push(`${plural(mm, 'payment is', 'payments are')} disputed in Payments${mm === 1 ? '' : ', the latest'}: ${name}, ${dayLabel(f.date)}. Employee entered ${fmtCurrency(f.employeeTotal)}, you entered ${fmtCurrency(f.ownerTotal)}. Paid out above uses your figure.`)
  }

  const hours = i.daysInMonth * i.standardDayHours
  return {
    shop: SHOP_NAME,
    monthLabel: i.monthLabel,
    standardHoursText: `${fmtHours(hours)} here (${i.daysInMonth} days of ${i.standardDayHours} hours)`,
    rows,
    totals,
    notes,
    preparedAt: i.now,
  }
}
