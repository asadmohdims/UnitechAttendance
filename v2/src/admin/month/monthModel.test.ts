import { describe, expect, it } from 'vitest'
import type { Employee, RecordRow } from '../../data/types'
import { buildMonthModel, buildPayLines, statsFor } from './monthModel'

// October 2026: the 1st is a Thursday; Fridays are 2, 9, 16, 23, 30. "Today" is Wed 14 Oct.
const today = '2026-10-14'
const emp = (id: string, name: string, extra: Partial<Employee> = {}): Employee => ({ id, name, active: true, avatar: null, created_at: '2026-01-01T00:00:00Z', ...extra })
const at = (date: string, h: number, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const rec = (o: Partial<RecordRow> & Pick<RecordRow, 'id' | 'emp_id' | 'date' | 'clock_in'>): RecordRow => ({
  clock_out: null, in_photo: 'p', out_photo: 'p', lunch_paid: false, created_at: o.clock_in, edited_at: null, orig_clock_in: null, orig_clock_out: null, ...o,
})
// A normal day: 9-1 and 2-6 = 8:00.
const fullDay = (empId: string, date: string): RecordRow[] => [
  rec({ id: `${empId}${date}a`, emp_id: empId, date, clock_in: at(date, 9), clock_out: at(date, 13) }),
  rec({ id: `${empId}${date}b`, emp_id: empId, date, clock_in: at(date, 14), clock_out: at(date, 18) }),
]
const base = { ym: '2026-10', overrides: [], overtime: [], today }

describe('buildMonthModel', () => {
  it('classifies each day: worked, absent, paid holiday, and nothing for a day that has not happened', () => {
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: [...fullDay('a', '2026-10-01'), ...fullDay('a', '2026-10-05')] })
    const kinds = Object.fromEntries(m.people[0].days.map((d) => [d.day, d.kind]))
    expect(kinds[1]).toBe('worked')
    expect(kinds[2]).toBe('holiday') // a Friday with no punches
    expect(kinds[3]).toBe('absent') // Saturday, nothing punched
    expect(kinds[14]).toBe('absent') // today, nothing yet (the Month grid counts it like the live report)
    expect(kinds[15]).toBe('none')
    expect(m.people[0].days[0].text).toBe('8:00')
  })

  it('counts a half day as half an absence, and keeps Days and Absent independent', () => {
    const half = [rec({ id: 'h', emp_id: 'a', date: '2026-10-06', clock_in: at('2026-10-06', 9), clock_out: at('2026-10-06', 13) })]
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: half })
    const p = m.people[0]
    expect(p.days[5].kind).toBe('half')
    expect(p.halfDays).toBe(1)
    expect(p.daysWorked).toBe(1)
    expect(p.absentEq).toBe(p.daysOff + 0.5)
  })

  it('marks a still-open past session "!" and the open session today "In"', () => {
    const records = [
      rec({ id: '1', emp_id: 'a', date: '2026-10-12', clock_in: at('2026-10-12', 9), out_photo: null }),
      rec({ id: '2', emp_id: 'a', date: today, clock_in: at(today, 9), out_photo: null }),
    ]
    const p = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records }).people[0]
    expect(p.days[11]).toMatchObject({ kind: 'open', text: '!' })
    expect(p.days[13]).toMatchObject({ kind: 'open', text: 'In', isToday: true })
    expect(p.needsReview).toBe(true)
  })

  it('flags a day closed without a clock-out photo, keeping its hours', () => {
    const d = '2026-10-12'
    const records = [
      rec({ id: '1', emp_id: 'a', date: d, clock_in: at(d, 9), clock_out: at(d, 13) }),
      rec({ id: '2', emp_id: 'a', date: d, clock_in: at(d, 14), clock_out: new Date(2026, 9, 13, 0, 0).toISOString(), out_photo: null }),
    ]
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records })
    const day = m.people[0].days[11]
    expect(day.flagged).toBe(true)
    expect(day.kind).toBe('worked')
    expect(day.text).toBe('8:00') // 9-1 (4:00) + 2 PM counted to the 6 PM closing (4:00), not to the midnight stamp
    expect(m.reviewRecords).toHaveLength(1)
  })

  it('marks a day reviewed once the owner has set its clock-out, and stops flagging it', () => {
    const d = '2026-10-12'
    const fixed = rec({ id: '1', emp_id: 'a', date: d, clock_in: at(d, 9), clock_out: at(d, 17), out_photo: null, edited_at: at('2026-10-14', 9), orig_clock_in: at(d, 9), orig_clock_out: null })
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: [fixed] })
    const day = m.people[0].days[11]
    expect(day.flagged).toBe(false)
    expect(day.reviewed).toBe(true)
    expect(m.reviewRecords).toHaveLength(0)
  })

  it('does not mark an ordinary day, or one still waiting for review, as reviewed', () => {
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: [...fullDay('a', '2026-10-05'), rec({ id: 'o', emp_id: 'a', date: '2026-10-06', clock_in: at('2026-10-06', 9), out_photo: null })] })
    expect(m.people[0].days.some((x) => x.reviewed)).toBe(false)
  })

  it('gives the team figures for no person and one person\'s for a chosen one', () => {
    const records = [...fullDay('a', '2026-10-05'), ...fullDay('a', '2026-10-06'), ...fullDay('b', '2026-10-05')]
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan'), emp('b', 'Shakib')], records })
    expect(statsFor(m, null)).toEqual({ hours: 24, daysWorked: 3, expectedDays: m.totals.expectedDays, absences: m.totals.absences, halfDays: 0 })
    const one = statsFor(m, m.people[0])
    expect(one.hours).toBe(16)
    expect(one.daysWorked).toBe(2)
    expect(one.expectedDays).toBe(m.people[0].days.filter((x) => ['worked', 'half', 'open', 'absent'].includes(x.kind)).length)
    expect(one.expectedDays).toBeLessThan(m.totals.expectedDays)
  })

  it('docks a Friday only when the day really is a paid holiday', () => {
    const overrides = [
      { emp_id: 'a', date: '2026-10-02', paid: false },
      { emp_id: 'a', date: '2026-10-01', paid: false }, // a worked day: ignored
    ]
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: fullDay('a', '2026-10-01'), overrides })
    expect(m.people[0].days[1].docked).toBe(true)
    expect(m.people[0].days[0].docked).toBe(false)
    expect(m.people[0].docked).toBe(1)
  })

  it('does not call a Friday before the person was added a holiday', () => {
    const m = buildMonthModel({ ...base, employees: [emp('a', 'New', { created_at: '2026-10-10T00:00:00Z' })], records: [] })
    expect(m.people[0].days[1].kind).toBe('none') // Fri 2 Oct
    expect(m.people[0].days[10].kind).toBe('absent') // Sat 11 Oct
  })

  it('folds overtime into paid hours and the total, not into exact punch hours', () => {
    const m = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: fullDay('a', '2026-10-01'), overtime: [{ emp_id: 'a', date: '2026-10-01', hours: 2 }] })
    const day = m.people[0].days[0]
    expect(day.exactHours).toBe(8)
    expect(day.paidHours).toBe(10)
    expect(day.text).toBe('10:00')
    expect(m.people[0].exactTotal).toBe(10)
  })

  it('includes an inactive person only if they have records', () => {
    const staff = [emp('a', 'Faizan'), emp('b', 'Gone', { active: false }), emp('c', 'Left', { active: false })]
    const m = buildMonthModel({ ...base, employees: staff, records: fullDay('b', '2026-10-01') })
    expect(m.people.map((p) => p.emp.name)).toEqual(['Faizan', 'Gone'])
  })
})

describe('buildPayLines', () => {
  const rates = { a: [{ monthly_salary: 18000, effective_from: '2026-01-01' }] }

  it('credits each paid Friday a standard day and divides by the real days in the month', () => {
    // One full day (8:00) + Fridays 2 and 9 paid = 8 + 16 = 24h of 248h (31 x 8).
    const records = [...fullDay('a', '2026-10-01')]
    const model = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records })
    const [line] = buildPayLines(model, rates, today)
    expect(line.paidFridays).toBe(2)
    expect(line.standardHours).toBe(248)
    expect(line.paidHours).toBe(8 + 16)
    expect(line.pay).toBeCloseTo((18000 / 248) * 24, 6)
  })

  it('does not credit a docked Friday', () => {
    const model = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: [], overrides: [{ emp_id: 'a', date: '2026-10-02', paid: false }] })
    const [line] = buildPayLines(model, rates, today)
    expect(line.dockedFridays).toBe(1)
    expect(line.paidFridays).toBe(1)
    expect(line.creditedHours).toBe(8)
  })

  it('has no pay and no hourly rate when no rate is in force', () => {
    const model = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: [] })
    const [line] = buildPayLines(model, {}, today)
    expect(line.rate).toBeNull()
    expect(line.pay).toBeNull()
    expect(line.hourly).toBeNull()
  })

  it('ignores a rate that starts after the period ends', () => {
    const model = buildMonthModel({ ...base, employees: [emp('a', 'Faizan')], records: [] })
    const [line] = buildPayLines(model, { a: [{ monthly_salary: 20000, effective_from: '2026-11-01' }] }, today)
    expect(line.rate).toBeNull()
  })
})
