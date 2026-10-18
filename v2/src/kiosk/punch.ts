import { PUNCH_COOLDOWN_MINUTES } from '@legacy/config.js'
import { punchLockedUntil } from '@legacy/punchCooldown.js'
import type { Store } from '../data/store'
import type { Employee, RecordRow } from '../data/types'

export type PunchOutcome =
  | { kind: 'repeat'; direction: 'in' | 'out'; at: string }
  | { kind: 'in'; record: RecordRow; at: string }
  | { kind: 'out'; closed: RecordRow; at: string }

interface PunchArgs {
  emp: Employee
  photo: Blob
  /** The employee's open session, if any (decides in vs out: the kiosk is a toggle). */
  open: RecordRow | undefined
  /** ISO instant of the employee's latest punch today, in either direction. */
  lastPunchIso: string | undefined
  store: Pick<Store, 'clockIn' | 'clockOut'>
  now?: Date
}

/** True while a tap on this employee's tile must be answered, not recorded (duplicate window). */
export function isInCooldown(lastPunchIso: string | undefined, now: Date = new Date()): boolean {
  return punchLockedUntil(lastPunchIso, PUNCH_COOLDOWN_MINUTES, now) !== null
}

/** The answer to a tap inside the duplicate window, or null when the tap is a real punch. */
export function repeatTap(open: RecordRow | undefined, lastPunchIso: string | undefined, now: Date = new Date()): Extract<PunchOutcome, { kind: 'repeat' }> | null {
  if (!lastPunchIso || !isInCooldown(lastPunchIso, now)) return null
  // Open session means the last punch was an in; otherwise it was an out.
  return { kind: 'repeat', direction: open ? 'in' : 'out', at: lastPunchIso }
}

/**
 * Records one punch, or recognises a repeat tap inside the duplicate-punch window and records
 * nothing. The window is checked here as well as on the tile tap: a retry from inside an
 * already-open camera dialog never goes through the tile (that is how a 1:01:48 clock-out was
 * once followed by a 1:01:50 clock-in).
 */
export async function performPunch({ emp, photo, open, lastPunchIso, store, now = new Date() }: PunchArgs): Promise<PunchOutcome> {
  const repeat = repeatTap(open, lastPunchIso, now)
  if (repeat) return repeat
  if (open) {
    await store.clockOut(open, photo)
    return { kind: 'out', closed: open, at: now.toISOString() }
  }
  const record = await store.clockIn(emp.id, photo)
  return { kind: 'in', record, at: record.clock_in }
}
