import { fmtHours, fmtTime } from '../format'
import type { DayModel, Problem } from './types'

const fmtDay = (date: string, opts: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', opts)
// "Mon 12 Oct": the Vocabulary's day format, no comma.
export const fmtDayShort = (date: string) => fmtDay(date, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
export const fmtDateTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${fmtTime(iso)}`

/** "57 min" / "1 hr 3 min": for gaps, where h:mm would read as a clock time. */
export function fmtGap(hours: number): string {
  const m = Math.max(0, Math.round(hours * 60))
  const hr = Math.floor(m / 60)
  const min = m % 60
  if (!hr) return `${min} min`
  return min ? `${hr} hr ${min} min` : `${hr} hr`
}

/** The stamp text for a callout (Vocabulary: one word per concept). */
export function calloutStamp(id: string, overtime?: number): string {
  const map: Record<string, string> = {
    syncing: 'Syncing',
    'still-in': 'Still in',
    'needs-clock-out': 'Missing clock-out',
    'open-past': 'Missing clock-out',
    'check-punches': 'Check punches',
    'no-lunch': 'No lunch punch?',
    edited: 'Edited',
    added: 'Added by you',
    'half-day': 'Half day',
    'not-in-yet': 'Not in yet',
    absent: 'Absent',
    holiday: 'Holiday',
  }
  return map[id] ?? (overtime ? `+${overtime}h overtime` : id)
}

/** The list chip's text. Same words as the callout stamp, except the list is shorter for lunch. */
export function chipText(id: string, fallback: string): string {
  if (id === 'needs-clock-out') return 'Missing clock-out'
  if (id === 'no-lunch') return 'No lunch'
  return fallback
}

/**
 * [lead, rest]: what happened, what it does to pay. Ported from js/ui/records.js calloutText so the
 * words match the live app (and the "every callout, in words" board).
 */
export function calloutText(model: DayModel, name: string, date: string): [string, string] {
  const c = model.callout
  if (!c) return ['', '']
  const sess = (i: number) => model.sessions[i].record
  const p = c.params as Record<string, unknown>
  switch (c.id) {
    case 'syncing':
      return ['Saved on the tablet.', 'It uploads when Wi-Fi returns. Nothing to do.']
    case 'still-in':
      return [`In since ${fmtTime(p.since as string)}.`, `Hours count once ${name} clocks out.`]
    case 'needs-clock-out':
      return ['No clock-out tap.', `The system closed it at ${fmtTime(p.closedAt as string)}. Pay counts to ${fmtTime(p.countedTo as string)} (${fmtHours(p.paid as number)}) until you enter the real time.`]
    case 'open-past':
      return ['Never clocked out.', `This session is still open from ${fmtDayShort(date)}. Enter the real clock-out time.`]
    case 'check-punches': {
      const problems = (p.problems ?? []) as Problem[]
      const first = problems[0]
      const more = problems.length > 1 ? ` (${problems.length - 1} more to check)` : ''
      const soFar = p.paid != null ? ` Pay so far: ${fmtHours(p.paid as number)}.` : ''
      if (first.kind === 'late-start') return ["This day doesn't look normal.", `The last session started at ${fmtTime(sess(first.index).clock_in)}, after closing. A punch may be missing.${soFar}${more}`]
      if (first.kind === 'short') return [`A ${first.minutes}-minute session at ${fmtTime(sess(first.index).clock_in)}.`, `Probably an accidental tap. It adds almost nothing to pay.${more}`]
      if (first.kind === 'long') return [`One session of ${fmtHours(first.hours as number)}.`, `That is longer than a normal day. Check the times.${more}`]
      return [
        `Session ${first.index + 1} starts at ${fmtTime(sess(first.index).clock_in)}, before session ${first.index} ends at ${fmtTime(sess(first.index - 1).clock_out as string)}.`,
        `Pay counts both, so ${first.minutes} minutes are paid twice.${more}`,
      ]
    }
    case 'no-lunch':
      return ['One long session with no lunch punch.', `If ${name} took a lunch break, use Split for lunch.`]
    case 'edited':
      return ['You changed the times on this day.', `Last edit ${fmtDateTime(p.editedAt as string)}. The kiosk's original times are kept on each edited session.`]
    case 'added':
      return ['You added this day.', `${fmtDateTime(p.editedAt as string)}. There are no photos because nobody was at the kiosk.`]
    case 'half-day':
      return ['Half day.', `One session of ${fmtHours(p.hours as number)}, so there is no lunch to look for.`]
    case 'not-in-yet':
      return ['No punches yet today.', 'Nothing to do until you expect them.']
    case 'absent':
      return [`No punches on ${fmtDayShort(date)}.`, `If ${name} was actually in, add the missed punch.`]
    case 'holiday':
      return [`${fmtDay(date, { weekday: 'long' })} is the weekly holiday.`, p.docked ? `You marked it unpaid for ${name} this month.` : 'Paid without punches.']
    default:
      return ['', '']
  }
}

/** "3 of 4 punches were set by you, not the kiosk". */
export function ownerLine(count: number, total: number): string {
  if (count === total) return total === 1 ? 'This punch was set by you, not the kiosk' : `All ${total} punches were set by you, not the kiosk`
  return `${count} of ${total} punches ${count === 1 ? 'was' : 'were'} set by you, not the kiosk`
}
