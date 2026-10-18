// The PIN pad's rules, apart from the screen so they can be tested. Wording is the Kiosk payments
// states board's. The lockout is client-side only and starts over each time the pad is reopened,
// the same as the live app: a 4-digit PIN cannot be made brute-force-proof in the browser.

export const PIN_LENGTH = 4
export const MAX_ATTEMPTS = 3

/** What checking the typed PIN found. 'offline' means the check itself could not run. */
export type PinCheck = 'ok' | 'wrong' | 'no-pin' | 'offline'

export interface PinState {
  digits: string
  /** Wrong PINs so far. An offline check or a missing PIN is not an attempt. */
  attempts: number
  problem: null | 'wrong' | 'locked' | 'no-pin' | 'offline'
}

export const startPin: PinState = { digits: '', attempts: 0, problem: null }

export const isLocked = (s: PinState) => s.attempts >= MAX_ATTEMPTS

export function pressDigit(s: PinState, digit: string): PinState {
  if (isLocked(s) || s.digits.length >= PIN_LENGTH) return s
  return { ...s, digits: s.digits + digit }
}

export const backspace = (s: PinState): PinState => (isLocked(s) ? s : { ...s, digits: s.digits.slice(0, -1) })

/** What happens after a full PIN was checked. 'ok' leaves the state alone: the caller moves on. */
export function applyCheck(s: PinState, check: PinCheck): PinState {
  if (check === 'ok') return s
  if (check === 'wrong') {
    const attempts = s.attempts + 1
    return { digits: '', attempts, problem: attempts >= MAX_ATTEMPTS ? 'locked' : 'wrong' }
  }
  return { ...s, digits: '', problem: check }
}

export const WRONG = (left: number) => `Incorrect PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`
export const LOCKED = 'Too many incorrect attempts. See the owner to reset your PIN.'
export const NO_PIN = 'No PIN set for you yet. Ask the owner.'
export const OFFLINE = "Can't check your PIN right now. Payments needs internet. Try again in a bit."
