import { describe, expect, it } from 'vitest'
import { rowTimes } from './dayText'
import type { DayModel, SessionView } from './types'

const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).toISOString()
const session = (inH: number, inM: number, out: [number, number] | null, outSlot: SessionView['slots']['out'] = 'photo'): SessionView =>
  ({ index: 0, record: { clock_in: at(inH, inM), clock_out: out ? at(...out) : null }, slots: { in: 'photo', out: outSlot } }) as unknown as SessionView
const model = (sessions: SessionView[], chipId?: string): DayModel => ({ kind: sessions.length ? 'worked' : 'empty', chip: chipId ? { id: chipId, tone: 'grey', text: '' } : null, callout: null, sessions, paidTotal: null, lunch: null, needsLook: false })

describe('rowTimes: the line under a name in the day list', () => {
  it('a normal day with a lunch gap reads first in to last out', () => {
    expect(rowTimes(model([session(9, 13, [13, 0]), session(13, 59, [18, 1])]))).toEqual({ text: '9:13 AM – 6:01 PM', tone: 'muted' })
  })
  it('someone still in on their only session reads "In since", in green', () => {
    expect(rowTimes(model([session(9, 30, null, 'not-yet')]))).toEqual({ text: 'In since 9:30 AM', tone: 'in' })
  })
  it('someone back from lunch and still in keeps their arrival time', () => {
    expect(rowTimes(model([session(9, 3, [13, 5]), session(14, 2, null, 'not-yet')]))).toEqual({ text: '9:03 AM – still in', tone: 'in' })
  })
  it('a day the kiosk closed at midnight says there is no clock-out, never the midnight stamp', () => {
    expect(rowTimes(model([session(9, 3, [13, 5]), session(14, 2, [24, 0], 'auto')]))).toEqual({ text: '9:03 AM – no clock-out', tone: 'attention' })
  })
  it('three or more sessions are called out, two are not', () => {
    expect(rowTimes(model([session(9, 0, [11, 0]), session(11, 30, [13, 0]), session(14, 0, [18, 0])])).text).toBe('9:00 AM – 6:00 PM · 3 sessions')
  })
  it('says why a row has no times', () => {
    expect(rowTimes(model([], 'absent')).text).toBe('No punches')
    expect(rowTimes(model([], 'not-in-yet')).text).toBe('Not in yet')
    expect(rowTimes(model([], 'holiday')).text).toBe('Holiday')
  })
})
