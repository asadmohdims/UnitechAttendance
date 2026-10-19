import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import type { Employee, RecordRow } from '../../data/types'
import { SheetsProvider } from '../../ui/Sheets'
import { buildExportSheet } from './exportXlsx'
import { buildMonthModel } from './monthModel'
import { MonthScreen } from './MonthScreen'
import { revalidateMonthAttendance } from './useMonthData'

const now = new Date(2026, 9, 14, 11, 0) // Wed 14 Oct 2026
const render = (ui: ReactElement) => rtlRender(<SheetsProvider>{ui}</SheetsProvider>)
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const staff: Employee[] = [
  { id: 'a', name: 'Faizan', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'b', name: 'Shakib', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
]
const rec = (o: Partial<RecordRow> & Pick<RecordRow, 'id' | 'emp_id' | 'date' | 'clock_in'>): RecordRow => ({
  clock_out: null, in_photo: 'p', out_photo: 'p', lunch_paid: false, created_at: o.clock_in, edited_at: null, orig_clock_in: null, orig_clock_out: null, ...o,
})
const full = (emp: string, d: string): RecordRow[] => [
  rec({ id: `${emp}${d}1`, emp_id: emp, date: d, clock_in: at(d, 9), clock_out: at(d, 13) }),
  rec({ id: `${emp}${d}2`, emp_id: emp, date: d, clock_in: at(d, 14), clock_out: at(d, 18) }),
]
// Faizan: three full days. Shakib: one full day, then a day left open on the 12th.
const records = [...full('a', '2026-10-05'), ...full('a', '2026-10-06'), ...full('a', '2026-10-07'), ...full('b', '2026-10-05'),
  rec({ id: 'open', emp_id: 'b', date: '2026-10-12', clock_in: at('2026-10-12', 9), out_photo: null })]

function boot() {
  queryCache.write('employees', staff)
  vi.spyOn(store, 'listEmployees').mockResolvedValue(staff)
  vi.spyOn(store, 'listRecordsForRange').mockResolvedValue(records)
  vi.spyOn(store, 'listOvertimeForRange').mockResolvedValue([])
  vi.spyOn(store, 'listDayPayOverrides').mockResolvedValue([])
  vi.spyOn(store, 'listSalaryRates').mockImplementation(async (id) => (id === 'a' ? [{ emp_id: 'a', monthly_salary: 18000, effective_from: '2026-01-01' }] : []))
  vi.spyOn(store, 'listPaymentsForRange').mockResolvedValue([{ id: 'p', emp_id: 'a', amount: 5000, occurred_on: '2026-10-10', entered_by: 'owner' }])
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const open = async (onOpenDay = vi.fn(), notify = vi.fn()) => {
  render(<MonthScreen onNotice={notify} onOpenDay={onOpenDay} nowOverride={now} />)
  await act(async () => {})
  return { onOpenDay, notify }
}

describe('Month · Attendance', () => {
  it('shows the review callout and opens the first flagged person in Days', async () => {
    boot()
    const { onOpenDay } = await open()
    expect(screen.getByText('1 entry needs review')).toBeInTheDocument()
    expect(screen.getByText(/Shakib has not clocked out yet\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review entries' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-12', 'b')
  })

  it('opens on the person who needs a look, with that day already showing', async () => {
    boot()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'One person' }))
    const detail = screen.getByRole('region', { name: /Shakib/ })
    expect(within(detail).getByText('Mon 12 Oct')).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: 'Open in Days' })).toBeInTheDocument()
  })

  it('opens on the whole team: one row per person, and a tap on a day opens that person on that day', async () => {
    boot()
    await open()
    const grid = screen.getByRole('table', { name: /Attendance by person and day/ })
    expect(within(grid).getAllByRole('row')).toHaveLength(3) // header + two people
    fireEvent.click(within(grid).getByRole('button', { name: /^Shakib, Mon 12 Oct/ }))
    const detail = screen.getByRole('region', { name: /Shakib/ })
    expect(within(detail).getByText('Mon 12 Oct')).toBeInTheDocument()
  })

  it('shows the team\'s figures for the whole team and one person\'s once chosen', async () => {
    boot()
    await open()
    const tile = (label: string) => screen.getByText(label).closest('.tc-stat') as HTMLElement
    expect(within(tile('Days worked')).getByText('4')).toBeInTheDocument() // Faizan 3 + Shakib 1
    expect(screen.getByText('Whole team', { selector: '.tc-stamp' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'One person' }))
    fireEvent.click(screen.getByText('Faizan').closest('button') as HTMLElement)
    expect(within(tile('Days worked')).getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Faizan', { selector: '.tc-stamp' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back to whole team/ }))
    expect(within(tile('Days worked')).getByText('4')).toBeInTheDocument()
  })

  it('marks a day the owner fixed as reviewed, and says so once nothing is left', async () => {
    boot()
    const fixed = [...records.filter((r) => r.id !== 'open'),
      rec({ id: 'fixed', emp_id: 'b', date: '2026-10-12', clock_in: at('2026-10-12', 9), clock_out: at('2026-10-12', 17), out_photo: null, edited_at: at('2026-10-14', 9), orig_clock_in: at('2026-10-12', 9), orig_clock_out: null })]
    vi.spyOn(store, 'listRecordsForRange').mockResolvedValue(fixed)
    await open()
    expect(screen.queryByText(/need review|needs review/)).toBeNull()
    expect(screen.getByText('All reviewed')).toBeInTheDocument()
    const grid = screen.getByRole('table', { name: /Attendance by person and day/ })
    expect(within(grid).getByRole('button', { name: /^Shakib, Mon 12 Oct.*reviewed$/ })).toBeInTheDocument()
  })

  it('counts the same days in the banner, the tile and the marks, including a day closed with no photo', async () => {
    boot()
    const noPhoto = rec({ id: 'np', emp_id: 'a', date: '2026-10-08', clock_in: at('2026-10-08', 9), clock_out: at('2026-10-08', 17), out_photo: null })
    vi.spyOn(store, 'listRecordsForRange').mockResolvedValue([...records, noPhoto])
    const { onOpenDay } = await open()
    expect(screen.getByText('2 entries need review')).toBeInTheDocument()
    const tile = screen.getByText('Needs attention').closest('.tc-stat') as HTMLElement
    expect(within(tile).getByText('2')).toBeInTheDocument()
    const grid = screen.getByRole('table', { name: /Attendance by person and day/ })
    expect(within(grid).getAllByRole('button', { name: /needs review$/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Review entries' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-12', 'b') // the newest item, top of the Days list
  })

  it('drops the review count when a fix made on another screen is re-read, with no reload', async () => {
    boot()
    await open()
    expect(screen.getByText('1 entry needs review')).toBeInTheDocument()
    const fixed = [...records.filter((r) => r.id !== 'open'),
      rec({ id: 'open', emp_id: 'b', date: '2026-10-12', clock_in: at('2026-10-12', 9), clock_out: at('2026-10-12', 17), out_photo: null, edited_at: at('2026-10-14', 9), orig_clock_in: at('2026-10-12', 9), orig_clock_out: null })]
    vi.spyOn(store, 'listRecordsForRange').mockResolvedValue(fixed)
    await act(async () => { await revalidateMonthAttendance('2026-10') })
    expect(screen.queryByText('1 entry needs review')).toBeNull()
    expect(screen.getByText('All reviewed')).toBeInTheDocument()
  })

  it('offers Add missed punch on an absent day', async () => {
    boot()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'One person' }))
    fireEvent.click(screen.getByText('Faizan').closest('button') as HTMLElement)
    const detail = screen.getByRole('region', { name: /Faizan/ })
    fireEvent.click(within(detail).getByRole('button', { name: /^Tue 13 Oct/ }))
    expect(within(detail).getByRole('button', { name: 'Add missed punch' })).toBeInTheDocument()
  })

  it('says so when the month has no attendance', async () => {
    boot()
    vi.spyOn(store, 'listRecordsForRange').mockResolvedValue([])
    await open()
    expect(screen.getByText('No completed attendance for this month.')).toBeInTheDocument()
  })
})

describe('Month · Pay', () => {
  it('shows each person, "No rate set" where none, and the calculation', async () => {
    boot()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await act(async () => {})
    expect(screen.getByText('No rate set')).toBeInTheDocument()
    expect(screen.getByText('₹5,000')).toBeInTheDocument() // already paid out: owner entries
    const row = screen.getByText('Faizan').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Show calculation' }))
    const calc = screen.getByRole('region', { name: /Faizan, how this is worked out/ })
    expect(within(calc).getByText(/₹18,000 ÷ 248:00 \(31 days × 8h\) = ₹72\.58/)).toBeInTheDocument()
    // 3 worked days (24:00) + 2 paid Fridays (16:00) = 40:00
    expect(within(calc).getByText(/24:00 worked \+ 16:00 \(2 paid holidays\) = 40:00/)).toBeInTheDocument()
  })
})

describe('Excel sheet', () => {
  it('matches the live export: exact hours, "IN (no out)" for an open day, totals without overtime', () => {
    const model = buildMonthModel({ ym: '2026-10', employees: staff, records, overrides: [], overtime: [{ emp_id: 'a', date: '2026-10-05', hours: 2 }], today: '2026-10-14' })
    const { header, rows } = buildExportSheet(model)
    expect(header[0]).toBe('Employee')
    expect(header[1]).toBe('2026-10-01')
    expect(header).toHaveLength(1 + 31 + 2)
    const faizan = rows[0]
    expect(faizan[0]).toBe('Faizan')
    expect(faizan[5]).toBe(8) // 5 Oct
    expect(faizan.at(-2)).toBe(3) // days worked
    expect(faizan.at(-1)).toBe(24) // overtime is not added
    expect(rows[1][12]).toBe('IN (no out)') // Shakib, 12 Oct
  })
})
