import { describe, expect, it } from 'vitest'
import { dayModel } from '@legacy/dayStatus.js'
import type { RecordRow } from '../data/types'
import { isConfirmedOnly, withReview } from './review'
import type { DayModel } from './types'

const D = '2026-10-07'
const now = new Date(2026, 9, 19, 23, 0)
const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 7, h, m, s).toISOString()
const rec = (o: Partial<RecordRow> & Pick<RecordRow, 'id' | 'clock_in'>): RecordRow => ({
  emp_id: 'a', date: D, clock_out: null, in_photo: 'p', out_photo: 'p', lunch_paid: false, created_at: o.clock_in, edited_at: null, orig_clock_in: null, orig_clock_out: null, ...o,
})
const model = (rows: RecordRow[]) => dayModel({ sessions: rows, date: D, today: '2026-10-19', now, overtimeHours: 0 }) as unknown as DayModel
// The real case from 7 Oct: a morning session with photos, an afternoon one closed at 6:01 PM with no out photo and no marker.
const morning = rec({ id: 'm', clock_in: at(9, 42), clock_out: at(13, 1) })
const afternoon = rec({ id: 'p', clock_in: at(14, 15), clock_out: at(18, 1), out_photo: null })

describe('withReview', () => {
  it('turns a day closed with no clock-out photo into a "No clock-out photo" item with Mark as reviewed first', () => {
    const rows = [morning, afternoon]
    const m = withReview(model(rows), rows)!
    expect(m.chip).toEqual({ id: 'no-photo', tone: 'amber', text: 'No clock-out photo' })
    expect(m.callout!.actions.map((a) => a.id)).toEqual(['mark-reviewed', 'edit-session'])
    expect(m.callout!.actions[0].primary).toBe(true)
    expect(m.callout!.actions[0].index).toBe(1)
    expect(m.needsLook).toBe(true)
  })

  it('leaves a normal day, and a day with a photo, alone', () => {
    const rows = [morning, { ...afternoon, out_photo: 'x' }]
    const m = model(rows)
    expect(withReview(m, rows)).toBe(m)
  })

  it('does not add it to a person who is simply clocked in', () => {
    const rows = [rec({ id: 'o', clock_in: at(9), out_photo: null })]
    const m = withReview(model(rows), rows)!
    expect(m.chip?.id).not.toBe('no-photo')
  })

  it('reads "Reviewed", not "You changed the times", once the owner has confirmed the times as they were', () => {
    const rows = [morning, { ...afternoon, edited_at: at(23, 2), orig_clock_in: afternoon.clock_in, orig_clock_out: afternoon.clock_out }]
    expect(isConfirmedOnly(rows[1])).toBe(true)
    const m = withReview(model(rows), rows)!
    expect(m.chip).toEqual({ id: 'reviewed', tone: 'blue', text: 'Reviewed' })
    expect(m.callout!.id).toBe('reviewed')
    expect(m.callout!.actions.map((a) => a.id)).toEqual(['edit-session'])
  })

  it('keeps "Edited" when the owner really moved a time', () => {
    const rows = [morning, { ...afternoon, clock_out: at(18, 0), edited_at: at(23, 2), orig_clock_in: afternoon.clock_in, orig_clock_out: afternoon.clock_out }]
    expect(isConfirmedOnly(rows[1])).toBe(false)
    expect(withReview(model(rows), rows)!.callout!.id).toBe('edited')
  })
})
