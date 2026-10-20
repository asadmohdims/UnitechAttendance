// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfmake from 'pdfmake'
import type { Employee, OvertimeRow, RecordRow } from '../data/types'
import { buildMonthModel, buildPayLines } from '../admin/month/monthModel'
import { PDF_FONTS } from './fonts'
import { payrollDoc } from './payrollDoc'
import { buildPayrollSummary } from './payrollModel'
import { attendanceDoc, GRID_PAGE_WIDTH, statementsDoc } from './reportDocs'
import { buildAttendanceReport, buildStatement } from './reportModel'

const NOW = new Date(2026, 9, 1, 9, 12)
const YM = '2026-09'
const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const emp = (id: string, name: string): Employee => ({ id, name, active: true, avatar: null, created_at: '2026-01-01T00:00:00Z' })
const NAMES = ['Shripal', 'Jamshaid', 'Raju', 'Qadir', 'Shakib', 'Imran', 'Faizan', 'Zubair', 'Mohammed', 'Hamza', 'Adeel', 'Bilal', 'Danish', 'Farhan']
const staff = (n: number) => NAMES.slice(0, n).map((name, i) => emp(`e${i}`, name))

// Every weekday except Fridays (the weekly holiday) is a full day 9 to 1 and 2 to 6; a few exceptions per person.
function records(people: Employee[]): RecordRow[] {
  const out: RecordRow[] = []
  people.forEach((p, pi) => {
    for (let d = 1; d <= 30; d++) {
      const date = `${YM}-${String(d).padStart(2, '0')}`
      if (new Date(2026, 8, d).getDay() === 5) continue
      if (d === 12 + pi) continue // absent
      const mk = (id: string, i: [number, number], o: [number, number]): RecordRow => ({
        id, emp_id: p.id, date, clock_in: at(date, ...i), clock_out: at(date, ...o), in_photo: 'p', out_photo: 'p', lunch_paid: false,
        created_at: at(date, ...i), edited_at: null, orig_clock_in: null, orig_clock_out: null,
      })
      if (d === 9 + pi) out.push(mk(`${p.id}-${d}`, [9, 3], [13, 5])) // half day
      else {
        out.push(mk(`${p.id}-${d}a`, [9, d % 4 === 0 ? 13 : 3], [13, 5]))
        out.push(mk(`${p.id}-${d}b`, [14, 2], [18, 1]))
      }
    }
  })
  return out
}
const overtime: OvertimeRow[] = [{ emp_id: 'e0', date: '2026-09-21', hours: 2 }]

const month = (people: Employee[]) => buildMonthModel({ ym: YM, employees: people, records: records(people), overrides: [], overtime, today: '2026-10-01' })
const rates = (people: Employee[]) => Object.fromEntries(people.map((p) => [p.id, [{ monthly_salary: 18000, effective_from: '2026-01-01' }]]))

const dir = path.resolve(__dirname, '../assets/pdf-fonts')
const fonts = Object.fromEntries(Object.entries(PDF_FONTS).map(([family, f]) => [family, { normal: path.join(dir, f.normal), bold: path.join(dir, f.bold) }]))
async function render(doc: TDocumentDefinitions): Promise<Buffer> {
  const engine = pdfmake as unknown as { setFonts: (f: unknown) => void; createPdf: (d: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> } }
  engine.setFonts(fonts)
  const buf = await engine.createPdf(doc).getBuffer()
  if (process.env.REPORT_OUT) {
    fs.mkdirSync(process.env.REPORT_OUT, { recursive: true })
    fs.writeFileSync(path.join(process.env.REPORT_OUT, `${String(doc.info?.title).replace(/[^a-z0-9]+/gi, '-')}.pdf`), buf)
  }
  return buf
}
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length

describe('the numbers on paper are the numbers on screen', () => {
  const people = staff(5)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')

  it('a person\'s hours in the attendance report are Month · Pay\'s "hours worked"', () => {
    const report = buildAttendanceReport(model, NOW)
    report.rows.forEach((row, i) => expect(row.hours).toBeCloseTo(lines[i].punchedHours, 5))
    expect(report.totals.hours).toBeCloseTo(lines.reduce((s, l) => s + l.punchedHours, 0), 5)
  })

  it('a day\'s cells add up to the person\'s total, and the codes follow the month model', () => {
    const report = buildAttendanceReport(model, NOW)
    for (const row of report.rows) {
      expect(row.cells.reduce((s, c) => s + (c.hours ?? 0), 0)).toBeCloseTo(row.hours, 5)
      expect(row.cells.filter((c) => c.code === 'F')).toHaveLength(4) // four Fridays in September 2026
      expect(row.cells.filter((c) => c.code === 'A')).toHaveLength(row.absent)
    }
    expect(report.heads.filter((h) => h.friday).map((h) => h.n)).toEqual([4, 11, 18, 25])
  })

  it('the statement\'s "hours counted" is exactly what Month · Pay counts, with overtime and paid Fridays shown apart', () => {
    const s = buildStatement(model, model.people[0], lines[0], NOW)
    expect(s.counted.worked).toBeCloseTo(lines[0].punchedHours, 5)
    expect(s.counted.fridayHours).toBe(32)
    expect(s.counted.overtime).toBe(2)
    expect(s.counted.total).toBeCloseTo(s.counted.worked + 32 + 2, 5)
    expect(s.counted.total).toBeCloseTo(lines[0].paidHours, 5)
    expect(s.leadBlanks).toBe(1) // 1 September 2026 is a Tuesday: one blank before it in a Monday-first week
  })
})

describe('what is printed says the right things', () => {
  const people = staff(2)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')
  it('names the shop, and makes no promise the owner has not made', () => {
    const all = JSON.stringify(attendanceDoc(buildAttendanceReport(model, NOW))) + JSON.stringify(statementsDoc([buildStatement(model, model.people[0], lines[0], NOW)]))
    expect(all).toContain('UNITECH MACHINERIES')
    expect(all).not.toContain('Unitech Attendance')
    expect(all).not.toMatch(/within 7 days|looks wrong/)
  })
})

describe('what is printed never carries money', () => {
  const people = staff(5)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')
  const text = (doc: TDocumentDefinitions) => JSON.stringify(doc.content) + JSON.stringify((doc.footer as (a: number, b: number) => unknown)(1, 1))

  it('the attendance report and the statements hold no rupee sign, salary, pay or payment wording', () => {
    const docs = [attendanceDoc(buildAttendanceReport(model, NOW)), statementsDoc(model.people.map((p, i) => buildStatement(model, p, lines[i], NOW)))]
    for (const doc of docs) {
      const all = text(doc)
      expect(all).not.toContain('₹')
      expect(all).not.toMatch(/salary|payment|balance|per hour|rate/i)
      expect(all).not.toMatch(/18000|18,000/)
    }
  })
})

describe('the owner payroll summary', () => {
  const people = staff(5)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')
  const payment = (id: string, emp: string, date: string, amount: number, by: 'owner' | 'employee') => ({ id, emp_id: emp, amount, occurred_on: date, entered_by: by, created_at: `${date}T10:00:00Z` })
  const build = (payments: ReturnType<typeof payment>[] | null, checkDates: Record<string, string[]> = {}) =>
    buildPayrollSummary({ monthLabel: 'September 2026', daysInMonth: 30, standardDayHours: 8, people: model.people, lines, payments: payments as never, ledger: null, checkDates, now: NOW })

  it('shows the same pay and balance as Month · Pay, counting only the owner\'s payments', () => {
    const pay0 = Math.round(lines[0].pay as number)
    const s = build([payment('1', 'e0', '2026-09-10', 5000, 'owner'), payment('2', 'e0', '2026-09-10', 9999, 'employee')])
    expect(s.rows[0].pay).toBe(`₹${pay0.toLocaleString('en-IN')}`)
    expect(s.rows[0].paidOut).toBe('₹5,000')
    expect(s.rows[0].balance).toBe(`₹${(pay0 - 5000).toLocaleString('en-IN')}`)
    expect(s.rows[0].balanceLabel).toBe('to pay')
    expect(s.rows[1].paidOut).toBe('₹0')
  })

  it('says settled, paid ahead and an unknown balance, and flags what needs a look', () => {
    const pay1 = Math.round(lines[1].pay as number)
    const s = build([payment('1', 'e1', '2026-09-20', pay1, 'owner'), payment('2', 'e2', '2026-09-20', Math.round(lines[2].pay as number) + 500, 'owner')], { e3: ['2026-09-08'] })
    expect(s.rows[1]).toMatchObject({ balance: '₹0', balanceLabel: 'settled', tone: 'settled' })
    expect(s.rows[2]).toMatchObject({ balance: '₹500', balanceLabel: 'paid ahead', tone: 'ahead' })
    expect(s.notes.join(' ')).toContain('Raju has been paid ₹500 more')
    expect(s.notes.join(' ')).toContain('1 day in Attendance still needs a look (Qadir, 8 Sep')
    const none = build(null)
    expect(none.rows[0]).toMatchObject({ paidOut: '—', balance: '—', balanceLabel: 'not known' })
    expect(none.notes[0]).toMatch(/Payments could not be read/)
  })

  it('draws a real one-page PDF with the rupee sign, unlike the hours-only reports', async () => {
    const doc = payrollDoc(build([payment('1', 'e0', '2026-09-10', 5000, 'owner')]))
    expect(JSON.stringify(doc.content)).toContain('₹')
    expect(JSON.stringify(doc.content)).toContain('OWNER COPY')
    expect(pageCount(await render(doc))).toBe(1)
  })
})

describe('the grid fits the page', () => {
  it.each([30, 31, 28])('a %i-day month, with its grid lines, stays inside the margins', (days) => {
    const people = staff(3)
    const ym = days === 31 ? '2026-10' : days === 28 ? '2026-02' : '2026-09'
    const m = buildMonthModel({ ym, employees: people, records: [], overrides: [], overtime: [], today: '2027-01-01' })
    const doc = attendanceDoc(buildAttendanceReport(m, NOW))
    const grid = (doc.content as { table?: { widths?: number[]; headerRows?: number } }[]).find((c) => c.table?.headerRows === 1)!
    const widths = grid.table!.widths as number[]
    const lines = 2 + (widths.length - 1) * 0.5
    expect(widths.reduce((a, b) => a + b, 0) + lines).toBeLessThanOrEqual(GRID_PAGE_WIDTH + 0.01)
    expect(widths.reduce((a, b) => a + b, 0) + lines).toBeGreaterThan(GRID_PAGE_WIDTH - 12)
  })
})

describe('the PDF itself', () => {
  it('draws the attendance report on one A4 landscape page for five people, with both fonts embedded', async () => {
    const people = staff(5)
    const pdf = await render(attendanceDoc(buildAttendanceReport(month(people), NOW)))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(1)
    expect(pdf.length).toBeGreaterThan(8_000)
    expect(pdf.length).toBeLessThan(400_000)
    const raw = pdf.toString('latin1')
    expect(raw).toMatch(/Figtree/)
    expect(raw).toMatch(/IBMPlexMono/)
    expect(raw).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/) // A4 landscape
  })

  it('continues onto a second page, with the header row repeated, when there are too many people for one', async () => {
    const people = staff(14)
    const pdf = await render(attendanceDoc(buildAttendanceReport(month(people), NOW)))
    expect(pageCount(pdf)).toBe(2)
  })

  it('draws one A4 portrait page per person, and a single person gives a single page', async () => {
    const people = staff(5)
    const model = month(people)
    const lines = buildPayLines(model, rates(people), '2026-10-01')
    const all = model.people.map((p, i) => buildStatement(model, p, lines[i], NOW))
    expect(pageCount(await render(statementsDoc(all)))).toBe(5)
    const one = await render(statementsDoc([all[2]]))
    expect(pageCount(one)).toBe(1)
    expect(one.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/) // A4 portrait
  })

  it('copes with a 31-day month and with no one in it', async () => {
    const m = buildMonthModel({ ym: '2026-10', employees: staff(2), records: [], overrides: [], overtime: [], today: '2026-11-01' })
    const pdf = await render(attendanceDoc(buildAttendanceReport(m, NOW)))
    expect(pageCount(pdf)).toBe(1)
  })
})
