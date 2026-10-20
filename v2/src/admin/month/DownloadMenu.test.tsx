import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Employee, RecordRow } from '../../data/types'

const renderPdf = vi.fn(async (_doc: TDocumentDefinitions) => new Blob(['%PDF-fake']))
const saveFile = vi.fn()
const shareOrSave = vi.fn(async () => 'shared' as const)
let sharing = false
vi.mock('../../reports/makePdf', () => ({ renderPdf: (d: TDocumentDefinitions) => renderPdf(d) }))
vi.mock('../../reports/deliver', () => ({ canShareFiles: () => sharing, saveFile: (...a: unknown[]) => saveFile(...a), shareOrSave: (...a: unknown[]) => shareOrSave(...(a as [])) }))

import { DownloadMenu } from './DownloadMenu'
import { buildMonthModel, buildPayLines } from './monthModel'

const at = (d: string, h: number) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).toISOString()
const staff: Employee[] = [
  { id: 'a', name: 'Faizan', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'b', name: 'Shakib Khan', active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' },
]
const rec = (emp: string, d: string, i: number, o: number): RecordRow => ({ id: `${emp}${d}${i}`, emp_id: emp, date: d, clock_in: at(d, i), clock_out: at(d, o), in_photo: 'p', out_photo: 'p', lunch_paid: false, created_at: at(d, i), edited_at: null, orig_clock_in: null, orig_clock_out: null })
const model = buildMonthModel({ ym: '2026-09', employees: staff, records: [rec('a', '2026-09-02', 9, 17), rec('b', '2026-09-02', 9, 17)], overrides: [], overtime: [], today: '2026-10-01' })
const lines = buildPayLines(model, {}, '2026-10-01')

const mount = () => {
  const onNotice = vi.fn()
  render(<DownloadMenu model={model} lines={lines} now={new Date(2026, 9, 1, 9, 12)} onNotice={onNotice} />)
  fireEvent.click(screen.getByRole('button', { name: /Download/ }))
  return { onNotice }
}
const click = async (name: RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  sharing = false
})

describe('Month · Download menu', () => {
  it('lists the three downloads in the board\'s words, with who each is for', () => {
    mount()
    expect(screen.getByText('Attendance report')).toBeInTheDocument()
    expect(screen.getByText('Shareable')).toBeInTheDocument()
    expect(screen.getByText('One page each: attendance and hours, no money · PDF')).toBeInTheDocument()
    expect(screen.getByText('2 people')).toBeInTheDocument()
    expect(screen.getByText('Owner only')).toBeInTheDocument()
    expect(screen.queryByText('Data for a spreadsheet')).toBeNull() // dropped on the owner's review: no Excel in 2.0
  })

  it('saves the attendance report on a desktop, with the month in the file name', async () => {
    mount()
    await click(/^Attendance report/)
    expect(renderPdf).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(renderPdf.mock.calls[0][0].content)).toContain('Attendance report · September 2026')
    expect(JSON.stringify(renderPdf.mock.calls[0][0].content)).not.toContain('₹') // the shareable one holds no money
    expect(shareOrSave).toHaveBeenCalledTimes(1) // the report goes through the share-or-save door; on a desktop that door saves
    expect(shareOrSave.mock.calls).toEqual([[expect.any(Blob), 'Attendance-2026-09.pdf', 'Attendance 2026 09']])
    expect(screen.queryByRole('menu')).toBeNull() // closed once it is done
  })

  it('offers each person their own one-page statement, and everyone in one file', async () => {
    mount()
    await click(/Employee statements/)
    expect(screen.getByText('All 2 in one PDF')).toBeInTheDocument()
    expect(screen.getByText('Faizan')).toBeInTheDocument()
    expect(screen.getAllByText('Save')).toHaveLength(2) // no share sheet on this device

    await click(/All 2 in one PDF/)
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'Statements-2026-09.pdf')
    const everyone = JSON.stringify(renderPdf.mock.calls[0][0].content)
    expect(everyone).toContain('Faizan')
    expect(everyone).toContain('Shakib Khan')
  })

  it('shares one person\'s statement where the device has a share sheet, and says "Share"', async () => {
    sharing = true
    mount()
    await click(/Employee statements/)
    expect(screen.getAllByText('Share')).toHaveLength(2)
    await click(/Shakib Khan/)
    expect(shareOrSave).toHaveBeenCalledWith(expect.any(Blob), 'Statement-2026-09-Shakib-Khan.pdf', 'Statement 2026 09 Shakib Khan')
    const only = JSON.stringify(renderPdf.mock.calls[0][0].content)
    expect(only).toContain('Shakib Khan')
    expect(only).not.toContain('Faizan') // one person, one page: nobody else's name on it
  })

  it('saves Attendance and pay, stamped for the owner, with the month in the file name', async () => {
    mount()
    await click(/Attendance and pay/)
    expect(renderPdf).toHaveBeenCalledTimes(1)
    const all = JSON.stringify(renderPdf.mock.calls[0][0].content)
    expect(all).toContain('Attendance and pay · September 2026')
    expect(all).toContain('OWNER COPY · NOT FOR STAFF')
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'Attendance-and-pay-2026-09.pdf')
  })

  it('says why when a PDF cannot be made, and stays open to try again', async () => {
    renderPdf.mockRejectedValueOnce(new Error('font file 404'))
    const { onNotice } = mount()
    await click(/Attendance report/)
    expect(onNotice).toHaveBeenCalledWith('Failed: font file 404')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Attendance report/ })).toBeEnabled()
  })

  it('closes on Escape', () => {
    mount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
