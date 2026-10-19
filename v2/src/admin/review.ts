import { needsReview } from '@legacy/reportMath.js'
import type { RecordRow } from '../data/types'
import type { DayModel } from './types'

const MIN = 60000
const sameMinute = (a: string | null, b: string | null) => !!a && !!b && Math.floor(new Date(a).getTime() / MIN) === Math.floor(new Date(b).getTime() / MIN)

/** The owner confirmed the times as they were: a marker was written, but neither punch moved. */
export function isConfirmedOnly(r: RecordRow): boolean {
  return !!r.edited_at && sameMinute(r.orig_clock_in, r.clock_in) && sameMinute(r.orig_clock_out, r.clock_out)
}

/** Chips that already say what is wrong with the day; the no-photo item only fills the gap they leave. */
const SPOKEN_FOR = new Set(['needs-clock-out', 'check-punches', 'still-in', 'syncing'])

/**
 * Two states the live app's day model has no words for, added here so the shared module stays as it is:
 *  - "No clock-out photo": a day closed with no photo and no owner marker, so it cannot be told from a time
 *    typed in later. Offers Mark as reviewed (confirm the times as they are) and Edit clock-out.
 *  - "Reviewed": the owner confirmed the times and changed nothing, so the day must not read "You changed the times".
 * Returns the same model when neither applies.
 */
export function withReview(model: DayModel | null, sessions: RecordRow[]): DayModel | null {
  if (!model || model.kind !== 'worked' || !sessions.length) return model
  const last = model.sessions.length - 1
  const lastView = model.sessions[last]
  const chipId = model.chip?.id

  if (needsReview(sessions) && lastView?.record.clock_out && !SPOKEN_FOR.has(chipId ?? '')) {
    return {
      ...model,
      chip: { id: 'no-photo', tone: 'amber', text: 'No clock-out photo' },
      callout: {
        id: 'no-photo',
        tone: 'amber',
        params: { part: lastView.label.split('· ').pop()!.toLowerCase(), out: lastView.record.clock_out, paid: lastView.paid, countedOut: lastView.countedOut },
        actions: [
          { id: 'mark-reviewed', label: 'Mark as reviewed', primary: true, index: last },
          { id: 'edit-session', label: 'Edit clock-out', index: last },
        ],
      },
      needsLook: true,
    }
  }

  if (model.callout?.id === 'edited' && !model.ownerPunchCount && model.sessions.every((s) => !s.record.edited_at || isConfirmedOnly(s.record))) {
    return {
      ...model,
      chip: { id: 'reviewed', tone: 'blue', text: 'Reviewed' },
      callout: { id: 'reviewed', tone: 'blue', params: { editedAt: model.callout.params.editedAt, paid: model.paidTotal }, actions: [{ id: 'edit-session', label: 'Edit clock-out', index: last }] },
    }
  }
  return model
}
