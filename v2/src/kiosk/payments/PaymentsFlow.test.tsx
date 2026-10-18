import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { hashPin } from '@legacy/pin.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { Employee, Payment } from '../../data/types'
import { dateKey } from '../../format'
import { Kiosk } from '../Kiosk'

const emps: Employee[] = [
  { id: 'e1', name: 'Faizan', active: true, avatar: null },
  { id: 'e2', name: 'Raju', active: true, avatar: null },
]
const today = dateKey()
const month = today.slice(0, 7)
const pay = (id: string, on: string, amount: number, by: 'employee' | 'owner'): Payment => ({ id, emp_id: 'e2', amount, occurred_on: on, entered_by: by })

let pinRecord: { hash: string; salt: string } | null = null
let listed: Payment[] = []

beforeEach(async () => {
  localStorage.clear()
  pinRecord = { salt: 'salt', hash: await hashPin('4821', 'salt') }
  listed = [pay('a', `${month}-02`, 1000, 'employee'), pay('b', `${month}-02`, 1000, 'employee'), pay('c', `${month}-01`, 5000, 'owner')]
  queryCache.write('employees', emps)
  queryCache.write('openSessions', {})
  queryCache.write(`records:${today}`, [])
  vi.spyOn(store, 'listEmployees').mockResolvedValue(emps)
  vi.spyOn(store, 'listOpenSessions').mockResolvedValue({})
  vi.spyOn(store, 'listRecordsForDate').mockResolvedValue([])
  vi.spyOn(store, 'getSyncStatus').mockResolvedValue({ pending: 0, stuck: false, signedOut: false })
  vi.spyOn(store, 'getEmployeePinRecord').mockImplementation(async () => pinRecord)
  vi.spyOn(store, 'listPaymentsForEmployeeRange').mockImplementation(async () => listed)
})
afterEach(() => vi.restoreAllMocks())

const mount = async () => {
  render(<Kiosk mediaDevices={{ getUserMedia: vi.fn() }} />)
  await act(async () => {})
}
const tapPin = async (pin: string) => {
  for (const d of pin) fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: d }))
  // Checking a PIN hashes it, which really is asynchronous: wait for the pad to say it is done.
  await waitFor(() => expect(document.querySelector('.tc-keypad')?.getAttribute('aria-busy')).not.toBe('true'))
}
const goToPin = async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
  fireEvent.click(screen.getByRole('button', { name: /Raju/ }))
  expect(screen.getByText('Enter PIN for Raju')).toBeInTheDocument()
}
const inFlow = async () => {
  await goToPin()
  await tapPin('4821')
  await waitFor(() => expect(screen.getByText('Logged this month')).toBeInTheDocument())
}

describe('Kiosk · payments mode', () => {
  it('swaps the same grid to payments, with the banner and the tile wording, and back', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
    expect(screen.getByText('Tap your name to log a payment you received')).toBeInTheDocument()
    expect(screen.getAllByText('Tap to log a payment')).toHaveLength(2)
    expect(screen.queryByText('Tap to clock in')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Attendance' }))
    expect(screen.getAllByText('Tap to clock in')).toHaveLength(2)
  })
})

describe('Kiosk · payments PIN', () => {
  it('counts down wrong PINs and locks after three, with the keypad off', async () => {
    await goToPin()
    await tapPin('0000')
    expect(screen.getByText('Incorrect PIN. 2 attempts left.')).toBeInTheDocument()
    await tapPin('0000')
    expect(screen.getByText('Incorrect PIN. 1 attempt left.')).toBeInTheDocument()
    await tapPin('0000')
    expect(screen.getByText('Too many incorrect attempts. See the owner to reset your PIN.')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '4' })).toBeDisabled()
    expect(store.getEmployeePinRecord).toHaveBeenCalledTimes(3)
  })

  it('says there is no PIN, and does not count that as a try', async () => {
    pinRecord = null
    await goToPin()
    await tapPin('1234')
    expect(screen.getByText('No PIN set for you yet. Ask the owner.')).toBeInTheDocument()
    pinRecord = { salt: 'salt', hash: await hashPin('4821', 'salt') }
    await tapPin('0000')
    expect(screen.getByText('Incorrect PIN. 2 attempts left.')).toBeInTheDocument()
  })

  it('says it cannot check offline, and does not count that either', async () => {
    vi.spyOn(store, 'getEmployeePinRecord').mockRejectedValue(new Error('offline'))
    await goToPin()
    await tapPin('4821')
    expect(screen.getByText("Can't check your PIN right now. Payments needs internet. Try again in a bit.")).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '4' })).toBeEnabled()
  })
})

describe('Kiosk · payments month and add', () => {
  it("shows only what the employee logged, never the owner's amount", async () => {
    await inFlow()
    expect(screen.getByText('₹2,000')).toBeInTheDocument() // 1,000 + 1,000 across two taps, theirs only
    expect(screen.getByText('₹1,000 + ₹1,000')).toBeInTheDocument()
    expect(screen.getByText('Not yet logged by you')).toBeInTheDocument() // the owner's day: date only
    expect(screen.queryByText(/5,000/)).toBeNull()
    expect(screen.queryByText(/Matched|Mismatch|Awaiting/)).toBeNull()
  })

  it('shows "—" and the reason when the month cannot be read, so nobody logs it twice', async () => {
    vi.spyOn(store, 'listPaymentsForEmployeeRange').mockRejectedValue(new Error('offline'))
    await goToPin()
    await tapPin('4821')
    await waitFor(() => expect(screen.getByText('Couldn’t load your payments. Payments needs internet. Check the Wi-Fi.')).toBeInTheDocument())
    expect(screen.queryByText('₹0')).toBeNull()
  })

  it('refuses a missing amount or date, saves with the employee side, then returns to Attendance', async () => {
    const add = vi.spyOn(store, 'addPayment').mockResolvedValue(pay('n', today, 1500, 'employee'))
    await inFlow()
    fireEvent.click(screen.getByRole('button', { name: 'Add a payment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }))
    expect(screen.getByText('Enter an amount.')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    for (const d of '1500') fireEvent.click(within(dialog).getByRole('button', { name: d }))
    expect(within(dialog).getByText('1,500')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }))
    expect(screen.getByText('Pick a date.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: today } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save payment' })) })
    expect(add).toHaveBeenCalledWith('e2', 1500, today, 'employee', expect.any(String))
    expect(screen.getByText('Payment logged')).toBeInTheDocument()
    expect(screen.getByText(/This will show in your payments this month/)).toBeInTheDocument()
    fireEvent.click(document.querySelector('.kiosk-confirm')!)
    expect(screen.getByRole('button', { name: 'Payments' })).toBeInTheDocument() // back on Attendance
    expect(screen.getAllByText('Tap to clock in')).toHaveLength(2)
  })

  it('keeps one id across a retry of the same payment, and a new one for a changed amount', async () => {
    const add = vi.spyOn(store, 'addPayment').mockRejectedValue(new Error('no response'))
    await inFlow()
    fireEvent.click(screen.getByRole('button', { name: 'Add a payment' }))
    const dialog = screen.getByRole('dialog')
    for (const d of '500') fireEvent.click(within(dialog).getByRole('button', { name: d }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save payment' })) })
    expect(screen.getByText("Couldn't save. Check Wi-Fi and try again.")).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save payment' })) })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save payment' })) })
    const ids = add.mock.calls.map((c) => c[4])
    expect(ids[0]).toBe(ids[1]) // same amount and date: a lost answer cannot become two payments
    expect(ids[2]).not.toBe(ids[0]) // a different amount is a different payment
    expect(add.mock.calls[2][1]).toBe(50)
  })
})
