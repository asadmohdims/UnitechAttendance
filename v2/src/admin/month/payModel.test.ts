import { describe, expect, it } from 'vitest'
import type { Payment } from '../../data/types'
import { buildSettlement } from './payModel'
import type { PayLine, PersonMonth } from './monthModel'

const emp = (id: string) => ({ id, name: id, active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' })
const line = (id: string, pay: number | null): PayLine => ({
  emp: emp(id), rate: pay === null ? null : { monthly: 1, from: '2026-01-01' }, standardHours: 240, hourly: null, paidHours: 0, punchedHours: 0,
  overtime: 0, creditedHours: 0, paidFridays: 0, dockedFridays: 0, totalFridays: 0, holidayHours: 0, paidHolidays: 0, dockedHolidays: 0, totalHolidays: 0, daysWorked: 0, pay,
})
const person = (id: string) => ({ emp: emp(id) }) as PersonMonth
const pay = (emp_id: string, amount: number, entered_by: 'owner' | 'employee' = 'owner', occurred_on = '2026-09-10'): Payment => ({ id: `${emp_id}${amount}${entered_by}`, emp_id, amount, occurred_on, entered_by })

const people = ['a', 'b', 'c', 'd', 'e'].map(person)
const lines = [line('a', 17250), line('b', 24000), line('c', 12500), line('d', 18800.4), line('e', null)]

describe('buildSettlement', () => {
  const s = buildSettlement(lines, people, [pay('a', 10000), pay('b', 24000), pay('c', 14000), pay('c', 999, 'employee'), pay('e', 300)])
  const by = (id: string) => s.rows.find((r) => r.line.emp.id === id)!

  it('sets owner-entered payments against pay, and names each state', () => {
    expect([by('a').status, by('a').left]).toEqual(['to-pay', 7250])
    expect([by('b').status, by('b').left]).toEqual(['settled', 0])
    expect([by('c').status, by('c').left]).toEqual(['ahead', -1500]) // the employee's own 999 is not counted
    expect([by('d').status, by('d').left, by('d').pay]).toEqual(['to-pay', 18800, 18800]) // whole rupees
    expect(by('e').status).toBe('no-rate')
  })

  it('totals what is earned, paid and still owed; paid ahead does not reduce what others are owed', () => {
    expect(s.earned).toBe(17250 + 24000 + 12500 + 18800)
    expect(s.paidOut).toBe(10000 + 24000 + 14000 + 300)
    expect(s.toPay).toBe(7250 + 18800)
    expect(s.toPayCount).toBe(2)
    expect(s.ahead).toBe(1500)
  })

  it('lists payments oldest first', () => {
    const t = buildSettlement([line('a', 100)], [person('a')], [pay('a', 5, 'owner', '2026-09-20'), pay('a', 7, 'owner', '2026-09-02')])
    expect(t.rows[0].entries.map((e) => e.date)).toEqual(['2026-09-02', '2026-09-20'])
  })

  it('shows "unknown", never zero, when the payments could not be read', () => {
    const u = buildSettlement(lines, people, null)
    expect(u.paidOut).toBeNull()
    expect(u.toPay).toBeNull()
    expect(u.rows[0]).toMatchObject({ status: 'unknown', paidOut: null, left: null })
    expect(u.earned).toBe(s.earned)
  })
})
