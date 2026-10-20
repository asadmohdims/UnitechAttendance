import { describe, expect, it } from 'vitest'
import type { DayPayOverride, Employee, RecordRow } from '../../data/types'
import { creditFor, declaredHolidays } from '../holidays'
import { personDayModel } from '../dayEntries'
import { buildMonthModel, buildPayLines } from './monthModel'

const YM = '2026-10'
const TODAY = '2026-10-20'
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const emp = (id: string, name: string, created = '2026-01-01T00:00:00Z'): Employee => ({ id, name, active: true, avatar: null, created_at: created })
const rec = (empId: string, date: string, from: number, to: number): RecordRow => ({
  id: `${empId}-${date}`, emp_id: empId, date, clock_in: at(date, from), clock_out: at(date, to), in_photo: 'p', out_photo: 'p', lunch_paid: false,
  created_at: at(date, from), edited_at: null, orig_clock_in: null, orig_clock_out: null,
})
const ov = (empId: string, date: string, paid: boolean): DayPayOverride => ({ emp_id: empId, date, paid })
const staff = [emp('a', 'Faizan'), emp('b', 'Shakib')]
const build = (records: RecordRow[] = [], overrides: DayPayOverride[] = [], employees = staff) =>
  buildMonthModel({ ym: YM, employees, records, overrides, overtime: [], today: TODAY })
const day = (m: ReturnType<typeof build>, id: string, date: string) => m.people.find((p) => p.emp.id === id)!.days.find((d) => d.date === date)!
const rates = { a: [{ monthly_salary: 24800, effective_from: '2026-01-01' }], b: [{ monthly_salary: 24800, effective_from: '2026-01-01' }] }

describe('declared holidays are read from the overrides', () => {
  it('a paid row on an ordinary date declares it; on a Friday it is just "restore as paid"', () => {
    const d = declaredHolidays([ov('a', '2026-10-13', true), ov('a', '2026-10-09', true), ov('b', '2026-10-14', false)])
    expect([...d]).toEqual(['2026-10-13'])
  })

  it('credits a standard day only once the date has happened and the person had started', () => {
    const declared = new Set(['2026-10-13'])
    const args = { weekday: 2, today: TODAY, declared, paid: undefined }
    expect(creditFor({ ...args, date: '2026-10-13', since: '2026-01-01' })).toEqual({ kind: 'holiday', docked: false })
    expect(creditFor({ ...args, date: '2026-10-13', since: '2026-10-14' })).toBeNull() // hired after it
    expect(creditFor({ ...args, date: '2026-10-21', since: '2026-01-01', declared: new Set(['2026-10-21']) })).toBeNull() // not yet
    expect(creditFor({ ...args, date: '2026-10-13', since: '2026-01-01', paid: false })).toEqual({ kind: 'holiday', docked: true })
    expect(creditFor({ ...args, date: '2026-10-12', since: '2026-01-01' })).toBeNull() // an ordinary day
  })
})

describe('a Friday someone came in on pays 8:00 and the hours', () => {
  const friday = '2026-10-09'
  it('keeps the day as worked, marks the credit, and counts the Friday as paid', () => {
    const m = build([rec('a', friday, 9, 11)])
    const d = day(m, 'a', friday)
    expect(d.kind).toBe('worked')
    expect(d.credit).toBe('friday')
    expect(d.docked).toBe(false)
    const lines = buildPayLines(m, rates, TODAY)
    const a = lines.find((l) => l.emp.id === 'a')!
    const b = lines.find((l) => l.emp.id === 'b')!
    expect(a.paidFridays).toBe(b.paidFridays) // the one who came in loses no Friday
    expect(a.punchedHours).toBe(2)
    expect(a.paidHours - b.paidHours).toBe(2) // ten hours for the day against eight
  })

  it('a docked Friday someone worked pays the hours worked only', () => {
    const m = build([rec('a', friday, 9, 11)], [ov('a', friday, false)])
    expect(day(m, 'a', friday).docked).toBe(true)
    const lines = buildPayLines(m, rates, TODAY)
    const a = lines.find((l) => l.emp.id === 'a')!
    const b = lines.find((l) => l.emp.id === 'b')!
    expect(a.dockedFridays).toBe(1)
    expect(b.paidHours - a.paidHours).toBe(6) // b has the 8:00; a has only the 2:00
  })
})

describe('a declared holiday', () => {
  const holiday = '2026-10-13' // a Tuesday
  const declare = [ov('a', holiday, true), ov('b', holiday, true)]

  it('is paid, not absent, for people who did not come in', () => {
    const m = build([], declare)
    expect(day(m, 'a', holiday)).toMatchObject({ kind: 'holiday', text: 'PH', credit: 'holiday', docked: false })
    expect(m.declaredHolidays).toEqual([holiday])
    const undeclared = build([])
    expect(day(undeclared, 'a', holiday).kind).toBe('absent') // without the marker it is an absence, as before
    expect(m.people[0].daysOff).toBe(undeclared.people[0].daysOff - 1)
    const a = buildPayLines(m, rates, TODAY)[0]
    expect(a.paidHolidays).toBe(1)
    expect(a.holidayHours).toBe(8)
  })

  it('adds the hours worked on top of the 8:00', () => {
    const m = build([rec('a', holiday, 10, 13)], declare)
    expect(day(m, 'a', holiday)).toMatchObject({ kind: 'worked', credit: 'holiday' })
    const lines = buildPayLines(m, rates, TODAY)
    const a = lines.find((l) => l.emp.id === 'a')!
    const b = lines.find((l) => l.emp.id === 'b')!
    expect(a.paidHours - b.paidHours).toBe(3)
  })

  it('one person can be taken off it, and a person with no row of their own is still on it', () => {
    const m = build([], [ov('a', holiday, true), ov('b', holiday, false)])
    expect(day(m, 'a', holiday).docked).toBe(false)
    expect(day(m, 'b', holiday)).toMatchObject({ credit: 'holiday', docked: true })
    const noRow = build([], [ov('a', holiday, true)]) // b was added to the roster after it was declared
    expect(day(noRow, 'b', holiday)).toMatchObject({ credit: 'holiday', docked: false })
    expect(buildPayLines(m, rates, TODAY)[1].dockedHolidays).toBe(1)
  })

  it('removing it (everyone off) leaves an ordinary absence', () => {
    const m = build([], [ov('a', holiday, false), ov('b', holiday, false)])
    expect(day(m, 'a', holiday)).toMatchObject({ kind: 'absent', credit: null })
  })

  it('a full month is still exactly the salary, because the standard hours already count every day', () => {
    // Everyone works every non-holiday day, nobody punches on the holiday: paid hours equal the month's standard hours.
    const records: RecordRow[] = []
    for (let d = 1; d <= 20; d++) {
      const date = `${YM}-${String(d).padStart(2, '0')}`
      if (new Date(`${date}T12:00:00`).getDay() === 5 || date === holiday) continue
      records.push(rec('a', date, 9, 17))
    }
    const m = buildMonthModel({ ym: '2026-10', employees: [emp('a', 'Faizan')], records, overrides: [ov('a', holiday, true)], overtime: [], today: '2026-10-20' })
    const line = buildPayLines(m, rates, '2026-10-20')[0]
    // Days 1-20 are all paid days (worked, Friday or the holiday): 20 x 8:00.
    expect(line.paidHours).toBe(20 * 8)
  })
})

describe('what a day says', () => {
  const base = { today: TODAY, now: new Date(2026, 9, 20, 12), overtimeHours: 0, since: '2026-01-01' as string | undefined }
  const sessions = [rec('a', '2026-10-09', 9, 11)]

  it('a holiday nobody punched on is paid 8:00 and says Holiday', () => {
    const m = personDayModel({ ...base, sessions: undefined, date: '2026-10-09', credit: { kind: 'friday', docked: false } })!
    expect(m.chip).toMatchObject({ id: 'holiday', text: 'Holiday' })
    expect(m.paidTotal).toBe(8)
    expect(m.needsLook).toBe(false)
    expect(personDayModel({ ...base, sessions: undefined, date: '2026-10-09', credit: { kind: 'friday', docked: true } })!.paidTotal).toBeNull()
  })

  it('a holiday someone worked is the sum, with a chip that says so', () => {
    const m = personDayModel({ ...base, sessions, date: '2026-10-09', credit: { kind: 'friday', docked: false } })!
    expect(m.holiday).toMatchObject({ kind: 'friday', docked: false, hours: 8, worked: 2 })
    expect(m.paidTotal).toBe(10)
    expect(m.chip).toMatchObject({ id: 'holiday-worked', text: 'Holiday + worked' })
  })

  it('keeps a more urgent chip, and a docked day is paid the hours worked only', () => {
    const open = [{ ...rec('a', '2026-10-09', 9, 11), clock_out: null }]
    const urgent = personDayModel({ ...base, sessions: open, date: '2026-10-09', today: '2026-10-09', credit: { kind: 'friday', docked: false } })!
    expect(urgent.chip?.id).toBe('still-in')
    expect(urgent.paidTotal).toBeNull() // still in: no final number
    const docked = personDayModel({ ...base, sessions, date: '2026-10-09', credit: { kind: 'friday', docked: true } })!
    expect(docked.paidTotal).toBe(2)
    expect(docked.chip?.id).toBe('half-day') // taken off the holiday, it is an ordinary short day again
  })

  it('an ordinary day is unchanged', () => {
    const m = personDayModel({ ...base, sessions: [rec('a', '2026-10-13', 9, 17)], date: '2026-10-13', credit: null })!
    expect(m.holiday).toBeUndefined()
    expect(m.paidTotal).toBe(8)
  })
})
