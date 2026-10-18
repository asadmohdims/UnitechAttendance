import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { Employee, RecordRow } from '../../data/types'
import { SheetsProvider } from '../../ui/Sheets'
import { DaysScreen } from './DaysScreen'

const now = new Date(2026, 9, 14, 11, 0) // Wed 14 Oct, 11:00
const render = (ui: ReactElement) => rtlRender(<SheetsProvider>{ui}</SheetsProvider>)
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
    const needsLook = screen.getByText('Needs a look').nextElementSibling as HTMLElement
    expect(needsLook.querySelector('.days-row')).toHaveTextContent('Shakib')
    const everyoneElse = screen.getByText('Everyone else').nextElementSibling as HTMLElement
    expect(everyoneElse).toHaveTextContent('Faizan')
    expect(everyoneElse).not.toHaveTextContent('Shakib')
  })

  it("shows the day's people above the month's Needs attention queue", async () => {
    boot([...faizan, ...shakib])
    await open()
    const day = screen.getByText('Needs a look')
    const queue = screen.getByRole('heading', { name: 'Needs attention' })
    expect(day.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  const save = (name = 'Save') => act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
  const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

  it('enters the real clock-out for a session the system closed, and writes only that', async () => {
    boot([...shakib, ...faizan])
    const update = vi.spyOn(store, 'updateRecordTimes').mockResolvedValue(undefined)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Enter clock-out time' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Edit Shakib')).toBeInTheDocument()
    expect(within(dialog).getByText(/The kiosk closed it automatically, so enter the real clock-out\./)).toBeInTheDocument()
    type(/Clock out/, '18:30')
    await save()
    expect(update).toHaveBeenCalledTimes(1)
    const [id, inIso, outIso] = update.mock.calls[0]
    expect(id).toBe('s2')
    expect(inIso).toBe(shakib[1].clock_in) // clock-in untouched: its exact stored instant is kept
    expect(new Date(outIso as string).getHours()).toBe(18)
  })

  it('refuses a clock-out before the clock-in in the board\'s words, and writes nothing', async () => {
    boot([...shakib, ...faizan])
    const update = vi.spyOn(store, 'updateRecordTimes')
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Enter clock-out time' }))
    await screen.findByRole('dialog')
    type(/Clock out/, '13:30')
    await save()
    expect(screen.getByText('Clock out must be after the 2:02 PM clock in.')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('says there is nothing to save when the times did not change', async () => {
    boot([...shakib, ...faizan])
    const update = vi.spyOn(store, 'updateRecordTimes')
    const notify = await open()
    // The morning session: its stored times are valid, so an untouched Save is a no-op.
    // (The auto-closed one opens at 12:00 AM on purpose, and has to be corrected.)
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    await screen.findByRole('dialog')
    await save()
    expect(update).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('No changes to save.')
  })

  it('adds a missed punch for an absent person', async () => {
    boot([...faizan]) // Shakib has no punches: Absent
    const add = vi.spyOn(store, 'addManualRecord').mockResolvedValue({} as RecordRow)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Add missed punch' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Add a missed punch for Shakib')).toBeInTheDocument()
    type('Clock in', '09:00')
    type(/Clock out/, '18:00')
    await save('Add')
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0]).toBe('b')
    expect(add.mock.calls[0][1]).toBe(D)
  })

  it('deletes a session only after the confirmation', async () => {
    boot([...shakib, ...faizan])
    const del = vi.spyOn(store, 'deleteRecord').mockResolvedValue(undefined)
    await open()
    fireEvent.click(screen.getAllByRole('button', { name: 'More for this session' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Delete session…' }))
    expect(await screen.findByText('Delete this record for Shakib?')).toBeInTheDocument()
    expect(del).not.toHaveBeenCalled()
    await save('Delete')
    expect(del).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
  })

  it('adds overtime, and refuses something that is not a number of hours', async () => {
    boot([...shakib, ...faizan])
    const set = vi.spyOn(store, 'setOvertimeHours').mockResolvedValue(undefined)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Add overtime' }))
    await screen.findByRole('dialog')
    type('Overtime hours', '0')
    await save()
    expect(screen.getByText('Enter a valid number of hours.')).toBeInTheDocument()
    type('Overtime hours', '2')
    await save()
    expect(set).toHaveBeenCalledWith('b', D, 2)
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

describe('Days · payment mismatches in the queue', () => {
  const owner = { id: 'p1', emp_id: 'a', amount: 1500, occurred_on: '2026-10-10', entered_by: 'owner' as const }
  const theirs = { id: 'p2', emp_id: 'a', amount: 1200, occurred_on: '2026-10-10', entered_by: 'employee' as const }

  it('lists a mismatch with both amounts, as the board does, and opens that person on that day', async () => {
    boot([...faizan])
    vi.spyOn(store, 'listPaymentsForRange').mockResolvedValue([owner, theirs])
    vi.spyOn(store, 'listPaymentResolutions').mockResolvedValue([])
    await open()
    const item = screen.getByText('Sat 10 Oct · you ₹1,500, Faizan ₹1,200').closest('button') as HTMLElement
    expect(within(item).getByText('Mismatch')).toBeInTheDocument()
    fireEvent.click(item)
    expect(window.location.hash).toBe('#/admin/days/2026-10-10')
  })

  it('drops it once the owner has marked it resolved', async () => {
    boot([...faizan])
    vi.spyOn(store, 'listPaymentsForRange').mockResolvedValue([owner, theirs])
    vi.spyOn(store, 'listPaymentResolutions').mockResolvedValue([{ emp_id: 'a', date: '2026-10-10', resolved: true }])
    await open()
    expect(screen.queryByText(/you ₹1,500/)).toBeNull()
  })

  it('shows no payment items when payments cannot be read, rather than failing the queue', async () => {
    boot([...faizan])
    vi.spyOn(store, 'listPaymentsForRange').mockRejectedValue(new Error('offline'))
    await open()
    expect(screen.queryByText(/Mismatch/)).toBeNull()
  })
})

describe('Days · queue judges days in clock-in order', () => {
  it('does not flag a normal two-session day just because the month query returned it afternoon-first', async () => {
    const day = '2026-10-07'
    const morning = rec({ id: 'm', emp_id: 'a', date: day, clock_in: at(day, 9, 13), clock_out: at(day, 13) })
    const afternoon = rec({ id: 'n', emp_id: 'a', date: day, clock_in: at(day, 13, 59), clock_out: at(day, 18, 1) })
    const { buildAttentionQueue } = await import('../dayEntries')
    // The database gives no order for a range read; the queue must not depend on it.
    expect(buildAttentionQueue(staff, [afternoon, morning], [], now)).toEqual([])
    expect(buildAttentionQueue(staff, [morning, afternoon], [], now)).toEqual([])
  })
})

describe('Days · the list says who is in and when', () => {
  // Its own day and rows: the in-memory read cache is shared by every test in this file, and a read still in
  // flight from an earlier test would answer for this one.
  const E = '2026-10-09'
  const openOn = async () => {
    render(<DaysScreen onNotice={vi.fn()} initialDate={E} nowOverride={now} />)
    await act(async () => {})
  }
  const fresh = () => [
    rec({ id: 'x1', emp_id: 'a', date: E, clock_in: at(E, 9), clock_out: at(E, 13) }),
    rec({ id: 'x2', emp_id: 'a', date: E, clock_in: at(E, 14), clock_out: at(E, 18) }),
    rec({ id: 'x3', emp_id: 'b', date: E, clock_in: at(E, 9, 3), clock_out: at(E, 13, 5) }),
    rec({ id: 'x4', emp_id: 'b', date: E, clock_in: at(E, 14, 2), clock_out: new Date(2026, 9, 10, 0, 0).toISOString(), out_photo: null }),
  ]

  it('shows first in to last out under each name', async () => {
    boot(fresh())
    await openOn()
    const rowOf = (name: string) => [...document.querySelectorAll<HTMLElement>('.days-row')].find((r) => r.textContent?.includes(name))!
    // Earlier tests leave their own records in the in-memory cache until this test's read lands.
    await waitFor(() => expect(within(rowOf('Faizan')).getByText('9:00 AM – 6:00 PM')).toBeInTheDocument())
    await waitFor(() => expect(within(rowOf('Shakib')).getByText('9:03 AM – no clock-out')).toBeInTheDocument())
  })

  it('on a phone a tap opens that person, and Back returns to the list', async () => {
    boot(fresh())
    await openOn()
    const root = document.querySelector('.days') as HTMLElement
    expect(root).not.toHaveClass('days--detail')
    fireEvent.click([...document.querySelectorAll<HTMLElement>('.days-row')].find((r) => r.textContent?.includes('Faizan'))!)
    expect(root).toHaveClass('days--detail')
    expect(screen.getByRole('region', { name: /Faizan/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '‹ Days' }))
    expect(root).not.toHaveClass('days--detail')
  })
})
