import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { DayPayOverride, Employee, RecordRow } from '../../data/types'
import { SheetsProvider } from '../../ui/Sheets'
import { DaysScreen } from './DaysScreen'

const now = new Date(2026, 9, 14, 11, 0) // Wed 14 Oct, 11:00
const render = (ui: ReactElement) => rtlRender(<SheetsProvider>{ui}</SheetsProvider>)
const TUE = '2026-10-13'
const FRI = '2026-10-09'
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const staff: Employee[] = [
  { id: 'a', name: 'Faizan', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'b', name: 'Shakib', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'c', name: 'Left', active: false, avatar: null, created_at: '2026-01-01T00:00:00Z' },
]
const rec = (date: string, empId: string, from: number, to: number): RecordRow => ({
  id: `${empId}-${date}`, emp_id: empId, date, clock_in: at(date, from), clock_out: at(date, to), in_photo: 'p', out_photo: 'p', lunch_paid: false,
  created_at: at(date, from), edited_at: null, orig_clock_in: null, orig_clock_out: null,
})

function boot(records: RecordRow[], overrides: DayPayOverride[] = []) {
  queryCache.write('employees', staff)
  vi.spyOn(store, 'listEmployees').mockResolvedValue(staff)
  vi.spyOn(store, 'listRecordsForDate').mockResolvedValue(records)
  vi.spyOn(store, 'listRecordsForRange').mockResolvedValue(records)
  vi.spyOn(store, 'listOvertimeForRange').mockResolvedValue([])
  vi.spyOn(store, 'listDayPayOverrides').mockResolvedValue(overrides)
}
const open = async (date: string) => {
  render(<DaysScreen onNotice={vi.fn()} initialDate={date} nowOverride={now} />)
  await act(async () => {})
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#/')
})

describe('Days · mark a paid holiday', () => {
  it('asks once, then marks the date for every active person', async () => {
    boot([])
    const set = vi.spyOn(store, 'setDayOverride').mockResolvedValue()
    await open(TUE)
    expect(document.querySelectorAll('.days-row .tc-stamp--alert')).toHaveLength(2) // before: a holiday nobody can punch for is an absence
    fireEvent.click(screen.getByRole('button', { name: 'Mark as paid holiday' }))
    expect(set).not.toHaveBeenCalled() // it asks first
    expect(screen.getByText('Mark Tue 13 Oct as a paid holiday?')).toBeInTheDocument()
    expect(screen.getByText(/All 2 people get 8:00 holiday pay/)).toBeInTheDocument() // the one who left is not counted
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as paid holiday' }).pop() as HTMLElement)
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set).toHaveBeenCalledWith('a', TUE, true)
    expect(set).toHaveBeenCalledWith('b', TUE, true)
  })

  it('writes nothing when cancelled', async () => {
    boot([])
    const set = vi.spyOn(store, 'setDayOverride').mockResolvedValue()
    await open(TUE)
    fireEvent.click(screen.getByRole('button', { name: 'Mark as paid holiday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => {})
    expect(set).not.toHaveBeenCalled()
  })

  it('has no button on a Friday, which is already a holiday', async () => {
    boot([])
    await open(FRI)
    expect(screen.queryByRole('button', { name: 'Mark as paid holiday' })).toBeNull()
    expect(screen.getAllByText('Holiday', { selector: '.tc-stamp' }).length).toBeGreaterThan(0)
  })

  it('shows a declared holiday as paid, and removing it takes the rows back off', async () => {
    boot([], [{ emp_id: 'a', date: TUE, paid: true }, { emp_id: 'b', date: TUE, paid: true }])
    const set = vi.spyOn(store, 'setDayOverride').mockResolvedValue()
    await open(TUE)
    expect(screen.getByText('Paid holiday', { selector: '.tc-stamp' })).toBeInTheDocument()
    expect(screen.queryByText('Absent', { selector: '.tc-stamp' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark as paid holiday' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove the holiday' }))
    expect(screen.getByText('Remove the holiday on Tue 13 Oct?')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove the holiday' }).pop() as HTMLElement)
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set).toHaveBeenCalledWith('a', TUE, false)
    expect(set).toHaveBeenCalledWith('b', TUE, false)
  })

  it('cannot be marked on a day that has not happened yet', async () => {
    boot([])
    await open('2026-10-20')
    expect(screen.queryByRole('button', { name: 'Mark as paid holiday' })).toBeNull()
  })
})

describe('Days · a holiday someone came in on', () => {
  it('says so, shows the 8:00 and the hours apart, and can take the holiday off for that person', async () => {
    boot([rec(FRI, 'a', 9, 11)])
    const set = vi.spyOn(store, 'setDayOverride').mockResolvedValue()
    await open(FRI)
    fireEvent.click(screen.getByRole('button', { name: /Faizan/ }))
    const detail = screen.getByRole('region', { name: /Faizan/ })
    expect(within(detail).getByText('Worked on the holiday', { selector: '.tc-stamp' })).toBeInTheDocument()
    expect(within(detail).getByText(/Faizan also worked 2:00, so this day is paid 10:00\./)).toBeInTheDocument()
    expect(within(detail).getByText('Holiday pay').nextSibling).toHaveTextContent('8:00')
    expect(within(detail).getByText('Worked today').nextSibling).toHaveTextContent('2:00')
    expect(within(detail).getByText('Paid today').nextSibling).toHaveTextContent('10:00')
    expect(screen.getByText('Holiday + worked', { selector: '.tc-stamp' })).toBeInTheDocument() // not "Half day"
    fireEvent.click(within(detail).getByRole('button', { name: 'Mark the holiday unpaid' }))
    await waitFor(() => expect(set).toHaveBeenCalledWith('a', FRI, false))
  })

  it('a docked holiday that was worked pays only the hours', async () => {
    boot([rec(FRI, 'a', 9, 11)], [{ emp_id: 'a', date: FRI, paid: false }])
    const set = vi.spyOn(store, 'setDayOverride').mockResolvedValue()
    await open(FRI)
    const detail = screen.getByRole('region', { name: /Faizan/ })
    expect(within(detail).getByText('Holiday unpaid', { selector: '.tc-stamp' })).toBeInTheDocument()
    fireEvent.click(within(detail).getByRole('button', { name: 'Restore as paid' }))
    await waitFor(() => expect(set).toHaveBeenCalledWith('a', FRI, true))
  })
})
