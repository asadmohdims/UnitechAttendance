import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { verifyPin } from '@legacy/pin.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { Employee, RecordRow } from '../../data/types'
import { SheetsProvider } from '../../ui/Sheets'
import { PeopleScreen } from './PeopleScreen'
import { countLine, orderPeople, pinProblem, rowSub } from './peopleModel'

const now = new Date(2026, 9, 14, 11, 0) // Wed 14 Oct 2026
const render = (ui: ReactElement) => rtlRender(<SheetsProvider>{ui}</SheetsProvider>)
const at = (d: string, h: number) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).toISOString()
const emp = (o: Partial<Employee> & Pick<Employee, 'id' | 'name'>): Employee => ({ active: true, avatar: null, created_at: '2026-01-01T00:00:00Z', pin_hash: 'h', pin_salt: 's', ...o })
const staff: Employee[] = [
  emp({ id: 'z', name: 'Zubair' }),
  emp({ id: 'm', name: 'Mohammed', pin_hash: null, pin_salt: null }),
  emp({ id: 'h', name: 'Hamza', active: false }),
  emp({ id: 'f', name: 'Faizan' }),
]
const open: RecordRow = {
  id: 'o', emp_id: 'f', date: '2026-10-14', clock_in: at('2026-10-14', 9), clock_out: null, in_photo: 'p', out_photo: null,
  lunch_paid: false, created_at: at('2026-10-14', 9), edited_at: null, orig_clock_in: null, orig_clock_out: null,
}

function boot(opts: { openSessions?: Record<string, RecordRow> } = {}) {
  queryCache.write('employees', staff)
  queryCache.write('openSessions', opts.openSessions ?? {})
  vi.spyOn(store, 'listEmployees').mockResolvedValue(staff)
  vi.spyOn(store, 'listOpenSessions').mockResolvedValue(opts.openSessions ?? {})
  vi.spyOn(store, 'listRecordsForRange').mockResolvedValue([])
  vi.spyOn(store, 'listOvertimeForRange').mockResolvedValue([])
  vi.spyOn(store, 'listDayPayOverrides').mockResolvedValue([])
  vi.spyOn(store, 'listSalaryRates').mockImplementation(async (id) => (id === 'z' ? [{ emp_id: 'z', monthly_salary: 18000, effective_from: '2026-01-01' }] : []))
  vi.spyOn(store, 'listPaymentsForRange').mockResolvedValue([
    { id: 'p1', emp_id: 'z', amount: 1200, occurred_on: '2026-10-10', entered_by: 'employee' },
    { id: 'p2', emp_id: 'z', amount: 1500, occurred_on: '2026-10-10', entered_by: 'owner' },
  ])
  vi.spyOn(store, 'listPaymentResolutions').mockResolvedValue([])
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const fakeStream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream
const camera = { getUserMedia: vi.fn(async () => fakeStream()) }
const goodPhoto = async () => new Blob(['jpg'], { type: 'image/jpeg' })

const mount = async (props: Partial<React.ComponentProps<typeof PeopleScreen>> = {}) => {
  const onNotice = vi.fn()
  const onLock = vi.fn()
  const onSignOut = vi.fn()
  render(<PeopleScreen onNotice={onNotice} onLock={onLock} onSignOut={onSignOut} nowOverride={now} mediaDevices={camera} capture={goodPhoto} {...props} />)
  await act(async () => {})
  return { onNotice, onLock, onSignOut }
}
const pick = async (name: string) => {
  fireEvent.click(screen.getAllByRole('listitem').find((b) => b.textContent?.includes(name)) as HTMLElement)
  await act(async () => {})
  return screen.getByRole('region', { name })
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = async (name = 'Save') => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }

describe('people model', () => {
  it('puts active people first, each group by name, and counts the inactive ones', () => {
    expect(orderPeople(staff).map((e) => e.name)).toEqual(['Faizan', 'Mohammed', 'Zubair', 'Hamza'])
    expect(countLine(staff)).toBe('4 total · 1 inactive')
    expect(countLine([])).toBe('')
    expect(rowSub(staff[1])).toBe('No PIN yet')
    expect(rowSub(staff[2])).toBe('Inactive · not on the kiosk · history kept')
  })
  it('accepts exactly four digits, leading zero included', () => {
    expect(pinProblem('0192')).toBeNull()
    expect(pinProblem('48')).toBe('PIN must be exactly 4 digits.')
    expect(pinProblem('48a1')).toBe('PIN must be exactly 4 digits.')
    expect(pinProblem('12345')).toBe('PIN must be exactly 4 digits.')
  })
})

describe('People', () => {
  it('lists everyone with the PIN and inactive marks the board draws', async () => {
    boot()
    await mount()
    expect(screen.getByText('4 total · 1 inactive')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').map((r) => r.querySelector('.tc-queue__title')?.textContent)
    expect(rows).toEqual(['Faizan', 'Mohammed', 'Zubair', 'Hamza'])
    expect(within(screen.getAllByRole('listitem')[1]).getByText('Set PIN')).toBeInTheDocument()
    expect(within(screen.getAllByRole('listitem')[3]).getByText('Inactive')).toBeInTheDocument()
  })

  it("shows a person's month: pay from the shared maths, payments with their reconciliation stamp, and the rate", async () => {
    boot()
    await mount()
    const page = await pick('Zubair')
    expect(within(page).getByText('Estimated pay')).toBeInTheDocument()
    expect(within(page).getAllByText(/₹18,000 a month/).length).toBeGreaterThan(0)
    expect(within(page).getByText('From 1 Jan 2026. Earlier months keep their own rate.')).toBeInTheDocument()
    // employee ₹1,200 against owner ₹1,500 on one day: the larger is counted and the day is a mismatch
    expect(within(page).getByText('₹1,500')).toBeInTheDocument()
    expect(within(page).getByText('Mismatch')).toBeInTheDocument()
  })

  it("cannot deactivate someone who is clocked in, and says why", async () => {
    boot({ openSessions: { f: open } })
    await mount()
    const page = await pick('Faizan')
    expect(within(page).getByRole('button', { name: 'Deactivate' })).toBeDisabled()
    expect(within(page).getByText(/Faizan is currently clocked in\. Clock them out before deactivating/)).toBeInTheDocument()
  })

  it('deactivates and activates, and re-reads the roster', async () => {
    boot()
    const setActive = vi.spyOn(store, 'setEmployeeActive').mockResolvedValue()
    await mount()
    let page = await pick('Zubair')
    await act(async () => { fireEvent.click(within(page).getByRole('button', { name: 'Deactivate' })) })
    expect(setActive).toHaveBeenCalledWith('z', false)
    page = await pick('Hamza')
    expect(within(page).getByText('Hamza is not on the kiosk')).toBeInTheDocument()
    await act(async () => { fireEvent.click(within(page).getByRole('button', { name: 'Activate' })) })
    expect(setActive).toHaveBeenCalledWith('h', true)
  })

  it('renames', async () => {
    boot()
    const rename = vi.spyOn(store, 'renameEmployee').mockResolvedValue()
    await mount()
    const page = await pick('Zubair')
    fireEvent.click(within(page).getByRole('button', { name: 'Rename' }))
    fill('Employee name', 'Zubair K')
    await save()
    expect(rename).toHaveBeenCalledWith('z', 'Zubair K')
  })

  it('refuses a PIN that is not four digits, keeps a leading zero, and stores a hash that verifies', async () => {
    boot()
    const setPin = vi.spyOn(store, 'setEmployeePin').mockResolvedValue()
    const { onNotice } = await mount()
    const page = await pick('Mohammed')
    fireEvent.click(within(page).getByRole('button', { name: 'Set PIN' }))
    expect(screen.getByText('Set PIN for Mohammed')).toBeInTheDocument()
    fill('4-digit PIN', '48')
    await save()
    expect(screen.getByText('PIN must be exactly 4 digits.')).toBeInTheDocument()
    expect(setPin).not.toHaveBeenCalled()
    fill('4-digit PIN', '0192')
    await save()
    await waitFor(() => expect(setPin).toHaveBeenCalledTimes(1)) // hashing is genuinely asynchronous
    const [id, hash, salt] = setPin.mock.calls[0]
    expect(id).toBe('m')
    expect(hash).not.toContain('0192') // only the hash is stored
    expect(await verifyPin('0192', salt, hash)).toBe(true)
    expect(await verifyPin('192', salt, hash)).toBe(false)
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('PIN set for Mohammed.'))
  })

  it('says Reset PIN where one is already set', async () => {
    boot()
    await mount()
    const page = await pick('Zubair')
    fireEvent.click(within(page).getByRole('button', { name: 'Reset PIN' }))
    expect(screen.getByText('Reset PIN for Zubair')).toBeInTheDocument()
  })

  it('changes the rate from the person page', async () => {
    boot()
    const setRate = vi.spyOn(store, 'setSalaryRate').mockResolvedValue()
    const { onNotice } = await mount()
    const page = await pick('Zubair')
    fireEvent.click(within(page).getByRole('button', { name: 'Change rate' }))
    fill('Monthly salary (₹)', '20000')
    fill('Effective from', '2026-10-14')
    await save('Save rate')
    expect(setRate).toHaveBeenCalledWith('z', { monthlySalary: 20000, effectiveFrom: '2026-10-14' })
    expect(onNotice).toHaveBeenCalledWith('Salary updated for Zubair')
  })

  it('adds a person, then opens the camera for their photo and saves it under a new path', async () => {
    boot()
    const added = emp({ id: 'n', name: 'Hamid', avatar: null })
    const add = vi.spyOn(store, 'addEmployee').mockResolvedValue(added)
    const upload = vi.spyOn(store, 'uploadPhoto').mockResolvedValue()
    const setAvatar = vi.spyOn(store, 'setEmployeeAvatar').mockResolvedValue()
    const { onNotice } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }))
    fill('Employee name', 'Hamid')
    await save('Add')
    expect(add).toHaveBeenCalledWith('Hamid')
    expect(await screen.findByText("Take Hamid's photo")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
    await act(async () => { fireEvent.loadedData(document.querySelector('video')!) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take photo' })) })
    const path = upload.mock.calls[0][0]
    expect(path).toMatch(/^n\/avatar-\d+\.jpg$/)
    expect(setAvatar).toHaveBeenCalledWith('n', path)
    expect(onNotice).toHaveBeenCalledWith('Photo saved for Hamid')
    expect(screen.queryByText("Take Hamid's photo")).toBeNull()
  })

  it('skipping the photo leaves the person added with no avatar', async () => {
    boot()
    vi.spyOn(store, 'addEmployee').mockResolvedValue(emp({ id: 'n', name: 'Hamid' }))
    const upload = vi.spyOn(store, 'uploadPhoto')
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }))
    fill('Employee name', 'Hamid')
    await save('Add')
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }))
    expect(upload).not.toHaveBeenCalled()
    expect(screen.queryByText("Take Hamid's photo")).toBeNull()
  })

  it('asks before signing out, and locks without asking', async () => {
    boot()
    const { onLock, onSignOut } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText('Sign out?')).toBeInTheDocument()
    expect(screen.getByText('The tablet will need the password to use the app again.')).toBeInTheDocument()
    expect(onSignOut).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' }).at(-1)!) })
    expect(onSignOut).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Lock admin' }))
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('shows a failed write as a notice, not silence', async () => {
    boot()
    vi.spyOn(store, 'renameEmployee').mockRejectedValue(new Error('no response'))
    const { onNotice } = await mount()
    const page = await pick('Zubair')
    fireEvent.click(within(page).getByRole('button', { name: 'Rename' }))
    fill('Employee name', 'Zub')
    await save()
    expect(onNotice).toHaveBeenCalledWith('Failed: no response')
  })
})
