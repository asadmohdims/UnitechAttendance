import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentConfirm } from './payments/PaymentConfirm'
import { PunchConfirm } from './PunchConfirm'

// The kiosk redraws every second for its clock and hands each confirmation a fresh onDone each time.
// The 1.8 s dismissal must not start over on every redraw (it once never fired at all).
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// Stable objects, as in the kiosk, where each confirmation is one piece of state.
const saved = { name: 'Raju', amount: 1500, date: '2026-10-10' }
const punch = { kind: 'in', name: 'Raju', at: '2026-10-10T09:00:00.000Z', photoUrl: null, initials: 'R' } as const

describe.each([
  ['payment', (done: () => void) => <PaymentConfirm saved={saved} onDone={done} />],
  ['punch', (done: () => void) => <PunchConfirm c={punch} onDone={done} />],
] as const)('%s confirmation', (_name, ui) => {
  it('dismisses itself 1.8 s after it appeared, however often the kiosk redraws', () => {
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    const { rerender } = render(ui(first))
    act(() => { vi.advanceTimersByTime(1000) })
    rerender(ui(second)) // a new onDone, as an inline arrow gives every render
    act(() => { vi.advanceTimersByTime(700) })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(second).not.toHaveBeenCalled()
    rerender(ui(third))
    act(() => { vi.advanceTimersByTime(200) })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(third).toHaveBeenCalledTimes(1) // the latest callback runs, once
  })
})
