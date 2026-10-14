import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { Employee, RecordRow } from '../../data/types'
import { DaysScreen } from './DaysScreen'

const now = new Date(2026, 9, 14, 11, 0) // Wed 14 Oct, 11:00
const D = '2026-10-13'
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const staff: Employee[] = [
  { id: 'a', name: 'Faizan', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'b', name: 'Shakib', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
]
const rec = (o: Partial<RecordRow> & Pick<RecordRow, 'id' | 'emp_id' | 'clock_in'>): RecordRow => ({
  date: D, clock_out: null, in_photo: 'p', out_photo: 'p', lunch_paid: false, created_at: o.clock_in,
  edited_at: null, orig_clock_in: null, orig_clock_out: null, ...o,
})
// Shakib: morning clock-in edited by the owner, afternoon closed by the system at midnight.
const shakib = [
  rec({ id: 's1', emp_id: 'b', clock_in: at(D, 9, 3), clock_out: at(D, 13, 5), edited_at: at(D, 16, 10), orig_clock_in: at(D, 9, 41), orig_clock_out: at(D, 13, 5) }),
  rec({ id: 's2', emp_id: 'b', clock_in: at(D, 14, 2), clock_out: new Date(2026, 9, 14, 0, 0).toISOString(), out_photo: null }),
]
const faizan = [rec({ id: 'f1', emp_id: 'a', clock_in: at(D, 9), clock_out: at(D, 13) }), rec({ id: 'f2', emp_id: 'a', clock_in: at(D, 14), clock_out: at(D, 18) })]

function boot(records: RecordRow[]) {
  queryCache.write('employees', staff)
  vi.spyOn(store, 'listEmployees').mockResolvedValue(staff)
  vi.spyOn(store, 'listRecordsForDate').mockResolvedValue(records)
  vi.spyOn(store, 'listRecordsForRange').mockResolvedValue(records)
  vi.spyOn(store, 'listOvertimeForRange').mockResolvedValue([])
  vi.spyOn(store, 'listDayPayOverrides').mockResolvedValue([])
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#/')
})

const open = async (notify = vi.fn()) => {
  render(<DaysScreen onNotice={notify} initialDate={D} nowOverride={now} />)
  await act(async () => {})
  return notify
}

describe('Days', () => {
  it('opens on the queued person and shows the owner-edit marks the live app shows', async () => {
    boot([...shakib, ...faizan])
    await open()
    const detail = screen.getByRole('region', { name: /Shakib/ })
    expect(within(detail).getByText('Missing clock-out')).toBeInTheDocument()
    expect(within(detail).getByText(/1 of 4 punches was set by you, not the kiosk/)).toBeInTheDocument()
    const mine = within(detail).getByTitle('Set by you, not by the kiosk')
    expect(mine).toHaveTextContent('✎ 9:03 AM')
    expect(within(detail).getByText('9:41 AM')).toBeInTheDocument() // what the kiosk recorded, struck through
    expect(within(detail).getByText(/Edited 13 Oct, 4:10 PM/)).toBeInTheDocument()
    expect(within(detail).getByText('no tap')).toBeInTheDocument()
    expect(within(detail).getByText('Paid to closing')).toBeInTheDocument()
  })

  it('puts the missing clock-out above the person with nothing wrong', async () => {
    boot([...faizan, ...shakib])
    await open()
    const list = screen.getAllByRole('list')
    const needsLook = list.find((l) => within(l).queryByText('Shakib'))!
    expect(within(needsLook).getAllByRole('listitem')[0]).toHaveTextContent('Shakib')
  })

  it('counts the people, the ones to look at and the edits in one line', async () => {
    boot([...shakib, ...faizan])
    await open()
    expect(screen.getByText(/2/, { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText(/1 with your edits|with your edits/)).toBeInTheDocument()
  })

  it('toggles lunch as paid work through the store, then re-reads the day', async () => {
    boot(faizan)
    const setLunchPaid = vi.spyOn(store, 'setLunchPaid').mockResolvedValue(undefined)
    await open()
    // With no punches for Shakib he is the one that needs a look, so pick Faizan first.
    fireEvent.click(screen.getAllByRole('button', { name: /Faizan/ }).find((b) => b.className.includes('days-row'))!)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pay as work' })) })
    expect(setLunchPaid).toHaveBeenCalledWith('f1', true)
  })

  it('says what is not built yet instead of looking dead', async () => {
    boot([...shakib, ...faizan])
    const notify = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Enter clock-out time' }))
    expect(notify).toHaveBeenCalledWith("Editing a session isn't built in 2.0 yet.")
  })

  it('draws from the saved day on first paint while the network never answers', () => {
    queryCache.write('employees', staff)
    queryCache.write(`records:${D}`, faizan)
    vi.spyOn(store, 'listEmployees').mockReturnValue(new Promise(() => {}))
    vi.spyOn(store, 'listRecordsForDate').mockReturnValue(new Promise(() => {}))
    vi.spyOn(store, 'listRecordsForRange').mockReturnValue(new Promise(() => {}))
    vi.spyOn(store, 'listOvertimeForRange').mockReturnValue(new Promise(() => {}))
    vi.spyOn(store, 'listDayPayOverrides').mockReturnValue(new Promise(() => {}))
    render(<DaysScreen onNotice={() => {}} initialDate={D} nowOverride={now} />)
    expect(screen.getAllByText('Faizan').length).toBeGreaterThan(0)
  })

  it('never lets the period go past today', async () => {
    boot(faizan)
    render(<DaysScreen onNotice={() => {}} initialDate="2026-10-14" nowOverride={now} />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
  })
})
