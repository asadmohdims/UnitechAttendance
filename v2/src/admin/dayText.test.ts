import { describe, expect, it } from 'vitest'
import { calloutText, fmtGap, holidayWorkedText, ownerLine } from './dayText'
import type { DayModel } from './types'

const base = (callout: DayModel['callout'], sessions: DayModel['sessions'] = []): DayModel => ({
  kind: 'worked', chip: null, callout, sessions, paidTotal: null, lunch: null, needsLook: false,
})

describe('calloutText (the words on the "every callout" board)', () => {
  it('missing clock-out', () => {
    const m = base({ id: 'needs-clock-out', tone: 'amber', params: { closedAt: new Date(2026, 9, 12, 0, 0).toISOString(), countedTo: new Date(2026, 9, 12, 18, 0).toISOString(), paid: 4 }, actions: [] })
    expect(calloutText(m, 'Shakib', '2026-10-12')).toEqual(['No clock-out tap.', 'The system closed it at 12:00 AM. Pay counts to 6:00 PM (4:00) until you enter the real time.'])
  })
  it('absent names the person and the day', () => {
    const m = base({ id: 'absent', tone: 'red', params: {}, actions: [] })
    expect(calloutText(m, 'Mohammed', '2026-10-12')).toEqual(['No punches on Mon 12 Oct.', 'If Mohammed was actually in, add the missed punch.'])
  })
  it('holiday, docked and not, weekly and declared', () => {
    const c = (params: Record<string, unknown>, date = '2026-10-09') => calloutText(base({ id: 'holiday', tone: 'violet', params, actions: [] }), 'Raju', date)
    expect(c({ docked: false })).toEqual(['Friday is the weekly holiday.', 'Paid 8:00 without punches. If Raju comes in, the hours worked are paid on top.'])
    expect(c({ docked: true })[1]).toBe('You marked it unpaid for Raju.')
    expect(c({ docked: false, declared: true }, '2026-10-20')[0]).toBe('Tue 20 Oct is a paid holiday.')
  })
  it('a holiday someone also worked reads as the sum', () => {
    expect(holidayWorkedText({ kind: 'friday', docked: false, hours: 8, worked: 2 }, 'Faizan', '2026-10-09')).toEqual(['Friday is the weekly holiday: 8:00 is paid.', 'Faizan also worked 2:00, so this day is paid 10:00.'])
    expect(holidayWorkedText({ kind: 'holiday', docked: false, hours: 8, worked: 3 }, 'Raju', '2026-10-20')[0]).toBe('Tue 20 Oct is a paid holiday: 8:00 is paid.')
    expect(holidayWorkedText({ kind: 'friday', docked: true, hours: 8, worked: 2 }, 'Raju', '2026-10-09')).toEqual(['Friday is the weekly holiday, but you marked it unpaid for Raju.', 'Only the 2:00 is paid.'])
    expect(holidayWorkedText({ kind: 'friday', docked: false, hours: 8, worked: null }, 'Raju', '2026-10-09')[1]).toMatch(/still in/)
  })
})

describe('small formats', () => {
  it('gaps are written in words, not as a clock', () => {
    expect(fmtGap(57 / 60)).toBe('57 min')
    expect(fmtGap(1 + 3 / 60)).toBe('1 hr 3 min')
    expect(fmtGap(2)).toBe('2 hr')
  })
  it('owner line', () => {
    expect(ownerLine(3, 4)).toBe('3 of 4 punches were set by you, not the kiosk')
    expect(ownerLine(1, 4)).toBe('1 of 4 punches was set by you, not the kiosk')
    expect(ownerLine(4, 4)).toBe('All 4 punches were set by you, not the kiosk')
    expect(ownerLine(1, 1)).toBe('This punch was set by you, not the kiosk')
  })
})
