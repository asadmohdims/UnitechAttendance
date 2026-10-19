import { buildEntryTimes, CLOCK_OUT_BEFORE_IN } from '@legacy/timeEntry.js'
import { isAutoClosedSession } from '@legacy/autoClosed.js'
import type { Employee, Payment, RecordRow } from '../data/types'
import { fmtTime } from '../format'
import type { PromptConfig } from '../ui/Sheets'
import { fmtDateTime, fmtDayShort } from './dayText'

type Times = { inIso: string; outIso: string | null; changed: boolean }
export interface TimeForm {
  config: PromptConfig
  /** The stored instants for what was typed, or null if it does not validate (validate() already said why). */
  resolve: (values: Record<string, string>) => Times | null
}

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
const longDay = (date: string) => `${fmtDayShort(date)} ${date.slice(0, 4)}` // "Mon 12 Oct 2026"

/** Turns typed HH:MM values into a validation message pinned to the field it belongs to. */
function checkTimes(date: string, v: Record<string, string>, existing?: Pick<RecordRow, 'clock_in' | 'clock_out'>) {
  const r = buildEntryTimes(date, v.clockIn, v.clockOut, existing ?? {}) as { error?: string } & Partial<Times>
  if (!r.error) return { times: r as Times, problem: null }
  // No shift here crosses midnight, so a clock-out at or before the clock-in is refused, never "fixed".
  if (r.error === CLOCK_OUT_BEFORE_IN) {
    const inAt = new Date(`${date}T00:00:00`)
    const [h, m] = v.clockIn.split(':').map(Number)
    inAt.setHours(h, m, 0, 0)
    return { times: null, problem: { field: 'clockOut', message: `Clock out must be after the ${fmtTime(inAt)} clock in.` } }
  }
  return { times: null, problem: { field: r.error.includes('clock-out') ? 'clockOut' : 'clockIn', message: r.error } }
}

/** What the owner is about to change, in plain words. */
function editNote(r: RecordRow): string[] {
  const day = longDay(r.date)
  const when = (inIso: string, outIso: string | null) => `${fmtTime(inIso)} to ${outIso ? fmtTime(outIso) : 'still in'}`
  if (r.edited_at) {
    const kiosk =
      r.orig_clock_in || r.orig_clock_out
        ? `The kiosk recorded ${when(r.orig_clock_in || r.clock_in, r.orig_clock_out)}. Last edited ${fmtDateTime(r.edited_at)}.`
        : `You added this record on ${fmtDateTime(r.edited_at)}.`
    return [day, kiosk]
  }
  const closed = isAutoClosedSession(r) ? ' The kiosk closed it automatically, so enter the real clock-out.' : ''
  return [day, `The kiosk recorded ${when(r.clock_in, r.clock_out)}.${closed}`]
}

export function sessionEditForm(r: RecordRow, name: string): TimeForm {
  return {
    config: {
      title: `Edit ${name}`,
      note: editNote(r),
      fields: [
        { name: 'clockIn', label: 'Clock in', type: 'time', value: hhmm(r.clock_in) },
        { name: 'clockOut', label: 'Clock out (leave empty if still in)', type: 'time', value: r.clock_out ? hhmm(r.clock_out) : '', required: false },
      ],
      validate: (v) => checkTimes(r.date, v, r).problem,
    },
    resolve: (v) => checkTimes(r.date, v, r).times,
  }
}

export function missedPunchForm(date: string, name: string): TimeForm {
  return {
    config: {
      title: `Add a missed punch for ${name}`,
      note: [longDay(date), 'This adds punches that were never recorded, so there will be no photos.'],
      submitLabel: 'Add',
      fields: [
        { name: 'clockIn', label: 'Clock in', type: 'time', placeholder: '9:00 AM' },
        { name: 'clockOut', label: 'Clock out (leave empty if still in)', type: 'time', placeholder: '6:00 PM', required: false },
      ],
      validate: (v) => checkTimes(date, v).problem,
    },
    resolve: (v) => checkTimes(date, v).times,
  }
}

export function confirmDeleteForm(name: string): PromptConfig {
  return {
    title: `Delete this record for ${name}?`,
    note: ['The punch and its photos are removed. This cannot be undone.'],
    submitLabel: 'Delete',
    danger: true,
    fields: [],
  }
}

/** Confirms a day's times as they are. Writes the edit marker without moving a punch, so it asks once. */
export function markReviewedForm(name: string, dayLabel: string, clockOut: string): PromptConfig {
  return {
    title: 'Mark this day as reviewed?',
    note: [`${name}, ${dayLabel}. The times stay exactly as they are (clock-out ${clockOut}). The day leaves your Needs attention list and shows as Reviewed. You can still edit the times afterwards.`],
    submitLabel: 'Mark as reviewed',
    fields: [],
  }
}

/** Month · Pay and the People page both change a rate, so they share this one dialog. */
export function rateForm(name: string, currentMonthly: number | null, today: string): PromptConfig {
  return {
    title: `Change salary for ${name}`,
    submitLabel: 'Save rate',
    fields: [
      { name: 'amount', label: 'Monthly salary (₹)', type: 'number', value: currentMonthly ? String(currentMonthly) : '', placeholder: 'e.g. 18000' },
      { name: 'effectiveFrom', label: 'Effective from', type: 'date', value: today, help: 'Past months keep their old rate.' },
    ],
    validate: (v) => (Number(v.amount) > 0 ? null : { field: 'amount', message: 'Enter a valid amount.' }),
  }
}

/** Owner logs a payment (pick the person) or edits one already logged (`existing`, person fixed). */
export function paymentForm(existing: Payment | null, people: Employee[], today: string, name?: string): PromptConfig {
  return {
    title: existing ? `Edit payment for ${name ?? 'this employee'}` : 'Log a payment',
    fields: [
      ...(existing ? [] : [{ name: 'empId', label: 'Employee', type: 'select' as const, options: people.map((e) => ({ value: e.id, label: e.name })) }]),
      { name: 'amount', label: 'Amount (₹)', type: 'number' as const, value: existing ? String(existing.amount) : '', placeholder: 'e.g. 1500' },
      { name: 'occurredOn', label: 'Date', type: 'date' as const, value: existing ? existing.occurred_on : today },
    ],
    validate: (v) => (Number(v.amount) > 0 ? null : { field: 'amount', message: 'Enter a valid amount.' }),
  }
}

export function confirmPaymentDeleteForm(name: string): PromptConfig {
  return { title: `Delete this payment entry for ${name}?`, submitLabel: 'Delete', danger: true, fields: [] }
}

export function overtimeForm(name: string, existing: number): PromptConfig {
  return {
    title: `${existing ? 'Edit' : 'Add'} overtime for ${name}`,
    fields: [{ name: 'hours', label: 'Overtime hours', type: 'number', value: existing ? String(existing) : '', placeholder: 'e.g. 2', help: 'Paid at the normal hourly rate.' }],
    validate: (v) => {
      const n = Number(v.hours)
      return Number.isFinite(n) && n > 0 ? null : { field: 'hours', message: 'Enter a valid number of hours.' }
    },
  }
}
