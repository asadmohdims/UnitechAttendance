import { CHIP_RANK, dayModel, emptyDayModel } from '@legacy/dayStatus.js'
import type { DayPayOverride, Employee, OvertimeRow, RecordRow } from '../data/types'
import { dateKey } from '../format'
import type { DayEntry, DayModel } from './types'

interface Args {
  employees: Employee[]
  records: RecordRow[]
  overtime: OvertimeRow[]
  overrides: DayPayOverride[]
  date: string
  now?: Date
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
  const docked = new Set(overrides.filter((o) => o.paid === false).map((o) => o.emp_id))
  const today = dateKey(now)
  const weekday = new Date(`${date}T12:00:00`).getDay()

  const entries: DayEntry[] = []
  for (const emp of employees.filter((e) => e.active || byEmp.has(e.id))) {
    const sessions = byEmp.get(emp.id)
    const overtimeHours = overtimeByEmp.get(emp.id) ?? 0
    const since = emp.created_at ? dateKey(new Date(emp.created_at)) : undefined
    const model = (
      sessions
        ? dayModel({ sessions, date, today, now, overtimeHours })
        : emptyDayModel({ date, today, weekday, employeeSince: since, now, docked: docked.has(emp.id) })
    ) as unknown as DayModel | null
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
  chipId: 'needs-clock-out' | 'check-punches' | 'payment-mismatch'
  text: string
  sub: string
}

/**
 * "Needs attention": every day in the range with a missing clock-out or punches to check, newest
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
      if (id !== 'needs-clock-out' && id !== 'check-punches') continue
      items.push({ emp: e.emp, date, chipId: id, text: e.model.chip!.text, sub: '' })
    }
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.emp.name.localeCompare(b.emp.name)))
}
