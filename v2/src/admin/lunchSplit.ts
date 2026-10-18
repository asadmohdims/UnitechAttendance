import { LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE } from '@legacy/config.js'

const MIN = 60000

/** A session needs a sliver of real work on both sides of an hour-long gap, or the split means nothing. */
export const MIN_SPLITTABLE_MS = 70 * MIN

/**
 * Where "Split for lunch" puts its one-hour gap: centred on the shop's usual lunch time when that
 * window fits inside the session with a 5-minute buffer each side, else on the session's midpoint.
 * One click, no time picker: picking exact times for a break nobody photographed adds friction
 * without adding accuracy, and either half stays editable afterwards.
 */
export function defaultLunchWindow(clockIn: Date, clockOut: Date): { start: Date; end: Date } {
  const cutoff = new Date(clockIn)
  cutoff.setHours(LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE, 0, 0)
  const half = 30 * MIN
  const buffer = 5 * MIN
  let start = new Date(cutoff.getTime() - half)
  let end = new Date(cutoff.getTime() + half)
  const fits = clockIn.getTime() + buffer <= start.getTime() && end.getTime() + buffer <= clockOut.getTime()
  if (!fits) {
    const mid = new Date((clockIn.getTime() + clockOut.getTime()) / 2)
    start = new Date(mid.getTime() - half)
    end = new Date(mid.getTime() + half)
  }
  return { start, end }
}
