import { describe, expect, it } from 'vitest'
import { backspaceAmount, groupAmount, MAX_DIGITS, pressAmountDigit } from './amountPad'
import { applyCheck, backspace, isLocked, MAX_ATTEMPTS, pressDigit, startPin } from './pinGate'

const type = (s: ReturnType<typeof pressDigit>, digits: string) => [...digits].reduce(pressDigit, s)

describe('PIN gate', () => {
  it('takes four digits and no more', () => {
    expect(type(startPin, '48215').digits).toBe('4821')
    expect(backspace(type(startPin, '48')).digits).toBe('4')
  })
  it('counts only wrong PINs, three of them, and then locks', () => {
    let s = applyCheck(type(startPin, '1111'), 'wrong')
    expect(s).toEqual({ digits: '', attempts: 1, problem: 'wrong' })
    s = applyCheck(type(s, '2222'), 'wrong')
    expect(s.attempts).toBe(2)
    expect(isLocked(s)).toBe(false)
    s = applyCheck(type(s, '3333'), 'wrong')
    expect(s.attempts).toBe(MAX_ATTEMPTS)
    expect(s.problem).toBe('locked')
    expect(isLocked(s)).toBe(true)
  })
  it('ignores keys once locked, so a fourth guess cannot be typed', () => {
    const locked = { digits: '', attempts: MAX_ATTEMPTS, problem: 'locked' as const }
    expect(pressDigit(locked, '1')).toBe(locked)
    expect(backspace(locked)).toBe(locked)
  })
  it('does not count "no PIN set" or "could not check" as an attempt', () => {
    const typed = type(startPin, '1234')
    expect(applyCheck(typed, 'offline')).toEqual({ digits: '', attempts: 0, problem: 'offline' })
    expect(applyCheck(typed, 'no-pin')).toEqual({ digits: '', attempts: 0, problem: 'no-pin' })
  })
  it('leaves the state alone on a right PIN, for the caller to move on', () => {
    const typed = type(startPin, '1234')
    expect(applyCheck(typed, 'ok')).toBe(typed)
  })
})

describe('amount pad', () => {
  const press = (digits: string) => [...digits].reduce(pressAmountDigit, '')
  it('stops at seven digits', () => {
    expect(press('123456789')).toBe('1234567')
    expect(press('123456789')).toHaveLength(MAX_DIGITS)
  })
  it('has no leading zero', () => {
    expect(press('0')).toBe('')
    expect(press('0050')).toBe('50')
  })
  it('groups in the Indian way', () => {
    expect(groupAmount('')).toBe('0')
    expect(groupAmount('1500')).toBe('1,500')
    expect(groupAmount('1234567')).toBe('12,34,567')
  })
  it('deletes one digit at a time', () => {
    expect(backspaceAmount('150')).toBe('15')
    expect(backspaceAmount('')).toBe('')
  })
})
