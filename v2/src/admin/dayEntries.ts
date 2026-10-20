import { CHIP_RANK, dayModel, emptyDayModel } from '@legacy/dayStatus.js'
import type { DayPayOverride, Employee, OvertimeRow, RecordRow } from '../data/types'
import { STANDARD_DAY_HOURS } from '@legacy/config.js'
import { dateKey } from '../format'
import { creditFor, declaredHolidays, type DayCredit } from './holidays'
import { withReview } from './review'
import type { DayEntry, DayModel } from './types'

interface Args {
  employees: Employee[]
  records: RecordRow[]
  overtime: OvertimeRow[]
  overrides: DayPayOverride[]
  date: string
  now?: Date
}

interface PersonDayArgs {
  sessions: RecordRow[] | undefined
  date: string
  today: string
  now: Date
  overtimeHours: number
  /** The person's start date, when known. */
  since: string | undefined
  /** What the date is worth whatever the punches (null on an ordinary day). */
  credit: DayCredit | null
}

/** A holiday nobody punched on: paid 8:00 (nothing if the owner took this person off it). */
function holidayEmpty(credit: DayCredit): DayModel {
  return {
    kind: 'empty',
    chip: { id: 'holiday', tone: 'violet', text: 'Holiday' },
    callout: {
      id: 'holiday', tone: 'violet', params: { docked: credit.docked, declared: credit.kind === 'holiday' },
      actions: [{ id: 'toggle-holiday', label: credit.docked ? 'Restore as paid' : 'Mark unpaid' }],
    },
    sessions: [], paidTotal: credit.docked ? null : STANDARD_DAY_HOURS, lunch: null, needsLook: false,
    holiday: { kind: credit.kind, docked: credit.docked, hours: STANDARD_DAY_HOURS, worked: null },
  }
}

/**
 * What one person's day says: the punches' own model, plus the standard day a Friday or a declared holiday pays.
 * Working such a day adds the hours to the 8:00, so `paidTotal` is the whole of it and `holiday.worked` the part
 * that was worked. Shared by Days and Month's day card so the two read a day the same way.
 */
export function personDayModel({ sessions, date, today, now, overtimeHours, since, credit }: PersonDayArgs): DayModel | null {
  if (!sessions || sessions.length === 0) {
    if (credit) return holidayEmpty(credit)
    return withReview(emptyDayModel({ date, today, weekday: new Date(`${date}T12:00:00`).getDay(), employeeSince: since, now }) as unknown as DayModel | null, [])
  }
  const base = withReview(dayModel({ sessions, date, today, now, overtimeHours }) as unknown as DayModel | null, sessions)
  if (!base || !credit) return base
  const worked = base.paidTotal
  // "Half day" would be wrong on a holiday someone popped in on, so the holiday says it instead.
  const dropHalf = !credit.docked && base.chip?.id === 'half-day'
  return {
    ...base,
    callout: dropHalf && base.callout?.id === 'half-day' ? null : base.callout,
    holiday: { kind: credit.kind, docked: credit.docked, hours: STANDARD_DAY_HOURS, worked },
    paidTotal: credit.docked || worked === null ? worked : worked + STANDARD_DAY_HOURS,
    chip: dropHalf || !base.chip ? (credit.docked ? base.chip : { id: 'holiday-worked', tone: 'violet', text: 'Holiday + worked' }) : base.chip,
  }
}

/**
 * One row per person for a day: everyone active (so Absent / Not in yet / Holiday get a row),
 * plus anyone inactive who still has punches that day. People who have no punches and nothing
 * worth a row (a day not yet happened, or before they were added) are left out. Rows that need
 * a look come first.
 */
export function buildDayEntries({ employees, records, overtime, overrides, date, now = new Date() }: Args): DayEntry[] {
  const byEmp = new Map<string, RecordRow[]>()
  for (const r of records) {
    if (!byEmp.has(r.emp_id)) byEmp.set(r.emp_id, [])
    byEmp.get(r.emp_id)!.push(r)
  }
  const overtimeByEmp = new Map(overtime.map((o) => [o.emp_id, Number(o.hours)]))
  const declared = declaredHolidays(overrides)
  const paidBy = new Map(overrides.filter((o) => o.date === date).map((o) => [o.emp_id, o.paid]))
  const today = dateKey(now)
  const weekday = new Date(`${date}T12:00:00`).getDay()

  const entries: DayEntry[] = []
  for (const emp of employees.filter((e) => e.active || byEmp.has(e.id))) {
    const sessions = byEmp.get(emp.id)
    const overtimeHours = overtimeByEmp.get(emp.id) ?? 0
    const since = emp.created_at ? dateKey(new Date(emp.created_at)) : undefined
    const model = personDayModel({ sessions, date, today, now, overtimeHours, since, credit: creditFor({ date, weekday, since, today, declared, paid: paidBy.get(emp.id) }) })
    if (model) entries.push({ emp, model, overtimeHours })
  }
  // Needs-a-look first, and within each group the most important chip first (a missing clock-out
  // before an absence). Array.prototype.sort is stable, so roster order is kept between equals.
  const rank = (e: DayEntry) => (e.model.chip ? ((CHIP_RANK as Record<string, number>)[e.model.chip.id] ?? 50) : 99)
  return entries.sort((a, b) => Number(b.model.needsLook) - Number(a.model.needsLook) || rank(a) - rank(b))
}

export interface QueueItem {
  emp: Employee
  date: string
  chipId: 'needs-clock-out' | 'check-punches' | 'no-photo' | 'payment-mismatch'
  text: string
  sub: string
}

/**
 * "Needs attention": every day in the range with a missing clock-out, a day closed with no clock-out photo, or punches to check, newest
 * first. Days are judged exactly as the Days list judges them (the same model), so the queue and
 * the list can never disagree about a day.
 */
export function buildAttentionQueue(employees: Employee[], records: RecordRow[], overtime: OvertimeRow[], now: Date = new Date()): QueueItem[] {
  const byDate = new Map<string, RecordRow[]>()
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date)!.push(r)
  }
  const items: QueueItem[] = []
  for (const [date, unsorted] of byDate) {
    // The month query returns rows in no particular order, but "Check punches" reads sessions in
    // clock-in order (a later session starting before an earlier one ended looks like an overlap).
    const rows = unsorted.slice().sort((a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime())
    const dayOvertime = overtime.filter((o) => o.date === date)
    for (const e of buildDayEntries({ employees, records: rows, overtime: dayOvertime, overrides: [], date, now })) {
      const id = e.model.chip?.id
      if (id === 'needs-clock-out' || id === 'check-punches') {
        items.push({ emp: e.emp, date, chipId: id, text: e.model.chip!.text, sub: '' })
        continue
      }
      if (id === 'no-photo') items.push({ emp: e.emp, date, chipId: 'no-photo', text: e.model.chip!.text, sub: '' })
    }
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.emp.name.localeCompare(b.emp.name)))
}
