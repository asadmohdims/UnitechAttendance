import { buildEntryTimes, CLOCK_OUT_BEFORE_IN } from '@legacy/timeEntry.js'
import { isAutoClosedSession } from '@legacy/autoClosed.js'
import type { RecordRow } from '../data/types'
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
