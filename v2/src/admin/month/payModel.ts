import type { Payment } from '../../data/types'
import type { PayLine, PersonMonth } from './monthModel'

/**
 * Pay's list: for each person, what the month earned (the same `PayLine` figure as before), what the
 * owner has logged as paid in Payments, and what is left. Only owner-entered payments count, as
 * "Already paid out" always did: the employee's own entries are the other half of the ledger's cross-check.
 * Nothing here feeds the pay maths; it only sets the two side by side.
 */
export type SettlementStatus = 'no-rate' | 'to-pay' | 'settled' | 'ahead' | 'unknown'

export interface SettlementRow {
  line: PayLine
  person: PersonMonth
  /** Whole rupees, as the list and tiles show them. */
  pay: number | null
  /** null when the payments read failed: that is not the same as "nothing paid". */
  paidOut: number | null
  entries: { date: string; amount: number }[]
  /** pay - paidOut. Negative = paid ahead. */
  left: number | null
  status: SettlementStatus
}

export interface Settlement {
  rows: SettlementRow[]
  earned: number
  paidOut: number | null
  /** Sum of what is still owed to people who are owed something. */
  toPay: number | null
  toPayCount: number
  /** Sum of what people have been paid beyond their pay. */
  ahead: number
}

export function buildSettlement(lines: PayLine[], people: PersonMonth[], payments: Payment[] | null): Settlement {
  const rows: SettlementRow[] = lines.map((line) => {
    const person = people.find((p) => p.emp.id === line.emp.id) as PersonMonth
    const pay = line.pay === null ? null : Math.round(line.pay)
    const entries = (payments ?? [])
      .filter((p) => p.entered_by === 'owner' && p.emp_id === line.emp.id)
      .map((p) => ({ date: p.occurred_on, amount: Number(p.amount) }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const paidOut = payments ? entries.reduce((s, e) => s + e.amount, 0) : null
    const left = pay === null || paidOut === null ? null : pay - paidOut
    const status: SettlementStatus = pay === null ? 'no-rate' : left === null ? 'unknown' : left > 0 ? 'to-pay' : left === 0 ? 'settled' : 'ahead'
    return { line, person, pay, paidOut, entries, left, status }
  })
  const owing = rows.filter((r) => r.status === 'to-pay')
  return {
    rows,
    earned: rows.reduce((s, r) => s + (r.pay ?? 0), 0),
    paidOut: payments ? rows.reduce((s, r) => s + (r.paidOut ?? 0), 0) : null,
    toPay: payments ? owing.reduce((s, r) => s + (r.left ?? 0), 0) : null,
    toPayCount: owing.length,
    ahead: rows.filter((r) => r.status === 'ahead').reduce((s, r) => s - (r.left ?? 0), 0),
  }
}
