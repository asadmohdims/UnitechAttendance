import { groupByEmployeeDate, reconcileDay } from '@legacy/paymentsMath.js'
import type { Employee, Payment, PaymentResolution } from '../../data/types'
import type { QueueItem } from '../dayEntries'

/**
 * The payments ledger, drawn from the live reconciliation maths (js/paymentsMath.js, unchanged):
 * the employee and the owner each log what they believe was paid, and a day is compared by the
 * sum of each side. This file only adds the owner's "resolved" mark and the roll-ups the screen shows.
 */
export type DayStatus = 'matched' | 'mismatch' | 'awaiting-owner' | 'awaiting-employee'

export interface LedgerDay {
  empId: string
  date: string
  payments: Payment[]
  status: DayStatus
  employeeTotal: number
  ownerTotal: number
  /** The owner marked a mismatch as talked through. The amounts stay as entered. */
  resolved: boolean
  ownerEntries: Payment[]
  employeeEntries: Payment[]
}

export interface LedgerPerson {
  empId: string
  emp: Employee | undefined
  /** Newest first. */
  days: LedgerDay[]
  /** Sum of each day's representative amount (see `representative`). */
  total: number
  unresolved: number
  awaiting: number
}

export interface Ledger {
  people: LedgerPerson[]
  /** One per employee and date: what the list calls an "entry". */
  entries: number
  totalLogged: number
  matched: number
  awaiting: number
  /** Mismatches nobody has marked resolved yet. */
  mismatches: number
  /** How far apart those unresolved days are, in rupees. */
  mismatchGap: number
  /** The first unresolved mismatch (newest), for the callout. */
  firstMismatch: LedgerDay | null
}

/** A day's one number for a total: the agreed amount, the only side that logged, or the larger of two that differ. */
function representative(d: { status: DayStatus; employeeTotal: number; ownerTotal: number }): number {
  return d.status === 'mismatch' ? Math.max(d.employeeTotal, d.ownerTotal) : d.employeeTotal || d.ownerTotal
}

export function buildLedger(payments: Payment[], resolutions: PaymentResolution[], employees: Employee[]): Ledger {
  const resolvedKeys = new Set(resolutions.filter((r) => r.resolved).map((r) => `${r.emp_id}:${r.date}`))
  const groups = groupByEmployeeDate(payments) as { emp_id: string; date: string; payments: Payment[] }[]

  const days: LedgerDay[] = groups.map((g) => {
    const r = reconcileDay(g.payments) as { status: DayStatus; employeeTotal: number; ownerTotal: number }
    return {
      empId: g.emp_id, date: g.date, payments: g.payments, ...r,
      resolved: resolvedKeys.has(`${g.emp_id}:${g.date}`),
      ownerEntries: g.payments.filter((p) => p.entered_by === 'owner'),
      employeeEntries: g.payments.filter((p) => p.entered_by === 'employee'),
    }
  })

  const byEmp = new Map<string, LedgerDay[]>()
  for (const d of days) byEmp.set(d.empId, [...(byEmp.get(d.empId) ?? []), d])

  const people: LedgerPerson[] = [...byEmp.entries()]
    .map(([empId, list]) => {
      const sorted = list.sort((a, b) => b.date.localeCompare(a.date))
      return {
        empId,
        emp: employees.find((e) => e.id === empId),
        days: sorted,
        total: sorted.reduce((s, d) => s + representative(d), 0),
        unresolved: sorted.filter((d) => d.status === 'mismatch' && !d.resolved).length,
        awaiting: sorted.filter((d) => d.status === 'awaiting-owner' || d.status === 'awaiting-employee').length,
      }
    })
    .sort((a, b) => (a.emp?.name ?? '').localeCompare(b.emp?.name ?? ''))

  const unresolved = days.filter((d) => d.status === 'mismatch' && !d.resolved)
  return {
    people,
    entries: days.length,
    totalLogged: days.reduce((s, d) => s + representative(d), 0),
    matched: days.filter((d) => d.status === 'matched').length,
    awaiting: days.filter((d) => d.status === 'awaiting-owner' || d.status === 'awaiting-employee').length,
    mismatches: unresolved.length,
    mismatchGap: unresolved.reduce((s, d) => s + Math.abs(d.employeeTotal - d.ownerTotal), 0),
    firstMismatch: unresolved.slice().sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
  }
}

/** The employee row's stamp: an unresolved mismatch outranks "awaiting", which outranks "all matched". */
export function worstCase(p: Pick<LedgerPerson, 'unresolved' | 'awaiting'>): 'mismatch' | 'awaiting' | 'matched' {
  return p.unresolved ? 'mismatch' : p.awaiting ? 'awaiting' : 'matched'
}

/** The line under a date: who logged. */
export function daySub(d: Pick<LedgerDay, 'status'>): string {
  return d.status === 'matched' ? 'Both sides logged'
    : d.status === 'mismatch' ? 'Both sides logged. Amounts differ.'
    : d.status === 'awaiting-owner' ? 'Logged by the employee only'
    : 'Logged by you only'
}

/**
 * The Days "Needs attention" queue's payment items: every mismatch the owner has not marked resolved,
 * worded as the Days board draws it ("you ₹1,500, Raju ₹1,200").
 */
export function paymentQueueItems(ledger: Ledger): QueueItem[] {
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  return ledger.people.flatMap((p) =>
    p.emp
      ? p.days
          .filter((d) => d.status === 'mismatch' && !d.resolved)
          .map((d) => ({
            emp: p.emp as Employee,
            date: d.date,
            chipId: 'payment-mismatch' as const,
            text: 'Mismatch',
            sub: `you ${rupees(d.ownerTotal)}, ${p.emp!.name.split(' ')[0]} ${rupees(d.employeeTotal)}`,
          }))
      : [],
  )
}
