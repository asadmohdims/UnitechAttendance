import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { Employee, Payment } from '../../data/types'
import { SheetsProvider } from '../../ui/Sheets'
import { MonthScreen } from './MonthScreen'
import { buildLedger, daySub, worstCase } from './paymentsModel'

const now = new Date(2026, 9, 14, 11, 0)
const render = (ui: ReactElement) => rtlRender(<SheetsProvider>{ui}</SheetsProvider>)
const emp = (id: string, name: string, active = true): Employee => ({ id, name, active, avatar: null, created_at: '2026-01-01T00:00:00Z' })
const staff = [emp('j', 'Jamshed'), emp('r', 'Raju'), emp('s', 'Shakib'), emp('x', 'Gone', false)]
const pay = (id: string, e: string, amount: number, on: string, by: 'employee' | 'owner'): Payment => ({ id, emp_id: e, amount, occurred_on: on, entered_by: by, created_at: `${on}T${by === 'owner' ? '10:40' : '13:12'}:00.000Z` })

const payments: Payment[] = [
  pay('j1', 'j', 3000, '2026-10-12', 'employee'), //                       Jamshed: only the employee logged
  pay('r1', 'r', 1200, '2026-10-10', 'employee'), pay('r2', 'r', 1500, '2026-10-10', 'owner'), // Raju: ₹300 apart
  pay('r3', 'r', 1000, '2026-10-05', 'employee'), pay('r4', 'r', 1000, '2026-10-05', 'employee'), pay('r5', 'r', 2000, '2026-10-05', 'owner'), // matched across two taps
  pay('r6', 'r', 800, '2026-10-01', 'employee'), pay('r7', 'r', 1000, '2026-10-01', 'owner'), //  apart but talked through
  pay('s1', 's', 2000, '2026-10-08', 'owner'), pay('s2', 's', 2000, '2026-10-08', 'employee'), // Shakib: agrees
]
const resolved = [{ emp_id: 'r', date: '2026-10-01', resolved: true }]

function boot(list: Payment[] | Error = payments) {
  queryCache.write('employees', staff)
  vi.spyOn(store, 'listEmployees').mockResolvedValue(staff)
  vi.spyOn(store, 'listRecordsForRange').mockResolvedValue([])
  vi.spyOn(store, 'listOvertimeForRange').mockResolvedValue([])
  vi.spyOn(store, 'listDayPayOverrides').mockResolvedValue([])
  vi.spyOn(store, 'listSalaryRates').mockResolvedValue([])
  if (list instanceof Error) vi.spyOn(store, 'listPaymentsForRange').mockRejectedValue(list)
  else vi.spyOn(store, 'listPaymentsForRange').mockResolvedValue(list)
  vi.spyOn(store, 'listPaymentResolutions').mockResolvedValue(resolved)
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const open = async () => {
  const notify = vi.fn()
  render(<MonthScreen onNotice={notify} onOpenDay={vi.fn()} nowOverride={now} />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
  await act(async () => {})
  return notify
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('ledger model', () => {
  const ledger = buildLedger(payments, resolved, staff)
  it('rolls days up: one number per day, the larger when two sides differ, unresolved mismatches only', () => {
    expect(ledger.entries).toBe(5)
    expect(ledger.totalLogged).toBe(3000 + 1500 + 2000 + 1000 + 2000) // 9,500
    expect(ledger.matched).toBe(2) // Raju 5 Oct (1,000 + 1,000 against 2,000) and Shakib
    expect(ledger.awaiting).toBe(1)
    expect(ledger.mismatches).toBe(1) // 1 Oct is a mismatch the owner marked resolved
    expect(ledger.mismatchGap).toBe(300)
    expect(ledger.firstMismatch?.date).toBe('2026-10-10')
  })
  it('orders people by name and days newest first', () => {
    expect(ledger.people.map((p) => p.emp?.name)).toEqual(['Jamshed', 'Raju', 'Shakib'])
    expect(ledger.people[1].days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-05', '2026-10-01'])
  })
  it("gives each person the worst day's stamp: mismatch, then awaiting, then matched", () => {
    expect(ledger.people.map(worstCase)).toEqual(['awaiting', 'mismatch', 'matched'])
    const noOpenMismatch = buildLedger(payments, [...resolved, { emp_id: 'r', date: '2026-10-10', resolved: true }], staff)
    expect(worstCase(noOpenMismatch.people[1])).toBe('matched')
  })
  it('says who logged', () => {
    expect(ledger.people[0].days[0].status).toBe('awaiting-owner')
    expect(daySub(ledger.people[0].days[0])).toBe('Logged by the employee only')
    expect(daySub({ status: 'awaiting-employee' })).toBe('Logged by you only')
  })
})

describe('Month · Payments', () => {
  it('shows the alert, the four totals and each person with their worst-case stamp', async () => {
    boot()
    await open()
    expect(screen.getByText('1 needs reconciliation')).toBeInTheDocument()
    expect(screen.getByText("Raju's entry doesn't match yours for Saturday, 10 October. See below.")).toBeInTheDocument()
    expect(screen.getByText('₹9,500')).toBeInTheDocument()
    expect(screen.getByText('₹300 apart')).toBeInTheDocument()
    expect(screen.getByText('… 1 awaiting')).toBeInTheDocument()
    expect(screen.getByText('! 1 mismatch')).toBeInTheDocument()
    expect(screen.getByText('✓ All matched')).toBeInTheDocument()
  })

  it('opens a person, then a day, and shows both sides with their own Edit and Delete', async () => {
    boot()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Raju/ }))
    expect(screen.getByText('₹1,200 vs ₹1,500')).toBeInTheDocument()
    expect(screen.getByText('✓ Resolved')).toBeInTheDocument() // 1 Oct
    fireEvent.click(screen.getByRole('button', { name: /Saturday, 10 October/ }))
    expect(screen.getByText('Your entry (owner)')).toBeInTheDocument()
    expect(screen.getByText("Raju's entry")).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
    expect(screen.getAllByText(/^Logged 10 Oct, /)).toHaveLength(2)
  })

  it('lists two taps on one day as two entries, not one bigger number', async () => {
    boot()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Raju/ }))
    fireEvent.click(screen.getByRole('button', { name: /Monday, 5 October/ }))
    expect(screen.getByText("Raju's entry")).toBeInTheDocument()
    expect(screen.getAllByText('₹1,000')).toHaveLength(2)
  })

  it('marks a mismatch resolved and can undo it, leaving the amounts alone', async () => {
    boot()
    const resolve = vi.spyOn(store, 'setPaymentResolution').mockResolvedValue()
    const update = vi.spyOn(store, 'updatePayment')
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Raju/ }))
    fireEvent.click(screen.getByRole('button', { name: /Saturday, 10 October/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' })) })
    expect(resolve).toHaveBeenCalledWith('r', '2026-10-10', true, null)
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Tuesday, 1 October|Thursday, 1 October/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '✓ Resolved, undo' })) })
    expect(resolve).toHaveBeenLastCalledWith('r', '2026-10-01', false, null)
  })

  it('edits one entry and deletes another, asking before deleting', async () => {
    boot()
    const update = vi.spyOn(store, 'updatePayment').mockResolvedValue()
    const remove = vi.spyOn(store, 'deletePayment').mockResolvedValue()
    await open()
    fireEvent.click(screen.getByRole('button', { name: /Raju/ }))
    fireEvent.click(screen.getByRole('button', { name: /Saturday, 10 October/ }))
    const [ownerEdit, employeeEdit] = screen.getAllByRole('button', { name: 'Edit' })
    fireEvent.click(ownerEdit)
    expect(screen.getByText('Edit payment for Raju')).toBeInTheDocument()
    fill('Amount (₹)', '1200')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(update).toHaveBeenCalledWith('r2', 1200, '2026-10-10')

    fireEvent.click(employeeEdit.closest('.led-card')!.querySelector('.tc-btn--danger')!)
    expect(screen.getByText('Delete this payment entry for Raju?')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })) })
    expect(remove).toHaveBeenCalledWith('r1')
  })

  it('logs an owner payment for an active person only', async () => {
    boot()
    const add = vi.spyOn(store, 'addPayment').mockResolvedValue(pay('n', 'r', 900, '2026-10-14', 'owner'))
    const notify = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Log a payment' }))
    const options = [...screen.getByLabelText('Employee').querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['Jamshed', 'Raju', 'Shakib']) // not the deactivated one
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'r' } })
    fill('Amount (₹)', '0')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(screen.getByText('Enter a valid amount.')).toBeInTheDocument()
    fill('Amount (₹)', '900')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(add).toHaveBeenCalledWith('r', 900, '2026-10-14', 'owner')
    expect(notify).toHaveBeenCalledWith('Payment logged.')
  })

  it('says so when nothing is logged', async () => {
    boot([])
    await open()
    expect(screen.getByText('No payments logged this month.')).toBeInTheDocument()
  })

  it('says the payments could not be loaded rather than showing an empty month', async () => {
    boot(new Error('offline'))
    await open()
    expect(screen.getByText('Couldn’t load payments. Check the Wi-Fi.')).toBeInTheDocument()
    expect(screen.queryByText('No payments logged this month.')).toBeNull()
  })

  it('shows a failed write as a notice', async () => {
    boot()
    vi.spyOn(store, 'setPaymentResolution').mockRejectedValue(new Error('no response'))
    const notify = await open()
    fireEvent.click(screen.getByRole('button', { name: /Raju/ }))
    fireEvent.click(screen.getByRole('button', { name: /Saturday, 10 October/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' })) })
    expect(notify).toHaveBeenCalledWith('Failed: no response')
  })
})
