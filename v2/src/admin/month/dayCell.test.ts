import { describe, expect, it } from 'vitest'
import { cameInOnHoliday, dayBase, dayText } from './dayCell'
import type { MonthDay } from './monthModel'

const day = (o: Partial<MonthDay>): MonthDay => ({
  day: 9, date: '2026-10-09', kind: 'worked', isToday: false, isFuture: false, text: '8:00', exactHours: 8, paidHours: 8, overtime: 0, sessions: [],
  flagged: false, reviewed: false, autoInfo: false, unbroken: false, docked: false, credit: null, ...o,
})

describe('a month cell on a holiday', () => {
  it('an ordinary worked day is green and shows its hours', () => {
    expect(dayBase(day({}))).toBe('full')
    expect(dayText(day({}))).toBe('8:00')
  })

  it('a Friday or declared holiday someone came in on is the holiday colour and shows the hours as an addition', () => {
    const d = day({ credit: 'friday', kind: 'half', paidHours: 2, text: '2:00' })
    expect(cameInOnHoliday(d)).toBe(true)
    expect(dayBase(d)).toBe('holiday')
    expect(dayText(d)).toBe('+2:00')
  })

  it('a declared holiday nobody came in on reads PH, in the holiday colour', () => {
    const d = day({ kind: 'holiday', credit: 'holiday', text: 'PH', exactHours: null, paidHours: null })
    expect(dayBase(d)).toBe('holiday')
    expect(dayText(d)).toBe('PH')
  })

  it('a holiday the owner took this person off keeps its worked colour and hours', () => {
    const d = day({ credit: 'friday', docked: true, paidHours: 2, text: '2:00', kind: 'half' })
    expect(cameInOnHoliday(d)).toBe(false)
    expect(dayBase(d)).toBe('half')
    expect(dayText(d)).toBe('2:00')
  })
})
