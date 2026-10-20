// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import pdfmake from 'pdfmake'
import type { DayPayOverride, Employee, OvertimeRow, RecordRow } from '../data/types'
import { buildMonthModel, buildPayLines } from '../admin/month/monthModel'
import { PDF_FONTS } from './fonts'
import { cardsDoc } from './cardsDoc'
import { statementsDoc } from './reportDocs'
import { buildCardReport, buildStatement } from './reportModel'

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

const month = (people: Employee[], overrides: DayPayOverride[] = []) => buildMonthModel({ ym: YM, employees: people, records: records(people), overrides, overtime, today: '2026-10-01' })
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

  it("a card's hours are Month · Pay's lines: worked, paid Fridays and overtime add up to the hours counted", () => {
    const report = buildCardReport(model, lines, NOW)
    report.people.forEach((c, i) => {
      expect(c.hours.worked).toBeCloseTo(lines[i].punchedHours, 5)
      expect(c.hours.fridays).toBe(lines[i].creditedHours)
      expect(c.hours.overtime).toBe(lines[i].overtime)
      expect(c.hours.total).toBeCloseTo(c.hours.worked + c.hours.fridays + c.hours.holidays + c.hours.overtime, 5)
      expect(c.hours.total).toBeCloseTo(lines[i].paidHours, 5)
    })
    expect(report.totals.hours.total).toBeCloseTo(lines.reduce((s, l) => s + l.paidHours, 0), 5)
  })

  it("a calendar's day cells add up to the person's worked hours, and the codes follow the month model", () => {
    const report = buildCardReport(model, lines, NOW)
    for (const c of report.people) {
      expect(c.cells.reduce((s, x) => s + (x.hours ?? 0), 0)).toBeCloseTo(c.hours.worked, 5)
      expect(c.cells.filter((x) => x.code === 'F')).toHaveLength(4) // four Fridays in September 2026
    }
    expect(report.leadBlanks).toBe(1) // 1 September 2026 is a Tuesday: one blank before it in a Monday-first week
  })

  it('a Friday the owner docked is drawn apart and is not counted: three paid Fridays, 24:00', () => {
    const docked = month(people, [{ emp_id: 'e0', date: '2026-09-18', paid: false }])
    const l = buildPayLines(docked, rates(people), '2026-10-01')
    const c = buildCardReport(docked, l, NOW).people[0]
    expect(c.cells.filter((x) => x.code === 'D').map((x) => x.day)).toEqual([18])
    expect(c.cells.filter((x) => x.code === 'F')).toHaveLength(3)
    expect(c.hours.fridays).toBe(24)
  })

  it('a Friday someone came in on is a Friday with their hours on top, and a declared holiday is PH', () => {
    const recs = [...records(people), { ...records([people[0]])[0], id: 'fri-work', date: '2026-09-11', clock_in: at('2026-09-11', 9), clock_out: at('2026-09-11', 11) }]
    const m = buildMonthModel({ ym: YM, employees: people, records: recs, overrides: [{ emp_id: 'e0', date: '2026-09-14', paid: true }], overtime, today: '2026-10-01' })
    const l = buildPayLines(m, rates(people), '2026-10-01')
    const r = buildCardReport(m, l, NOW)
    const c = r.people[0]
    expect(c.cells.find((x) => x.day === 11)).toEqual({ day: 11, code: 'F', hours: 2 }) // the Friday keeps its 8:00 and the 2:00 is shown
    expect(c.cells.find((x) => x.day === 14)).toMatchObject({ code: 'PH' }) // the declared Monday: paid, not absent
    expect(r.people[1].cells.find((x) => x.day === 14)).toMatchObject({ code: 'PH' }) // for everyone, whichever rows exist
    expect(c.hours.fridays).toBe(32)
    expect(c.hours.holidays).toBe(8)
    expect(c.hours.total).toBeCloseTo(c.hours.worked + 32 + 8 + 2, 5)
    expect(r.holidayDates).toEqual(['2026-09-14'])
    const all = JSON.stringify(cardsDoc(r).content)
    expect(all).toContain('+2:00')
    expect(all).toContain('Paid holiday')
    expect(all).toContain('Mon 14 Sep')
  })

  it('the statements say the paid holidays apart, only when there are any', () => {
    const plain = buildStatement(model, model.people[0], lines[0], NOW)
    expect(plain.counted.paidHolidays).toBe(0)
    const m = month(people, [{ emp_id: 'e0', date: '2026-09-14', paid: true }])
    const l = buildPayLines(m, rates(people), '2026-10-01')
    const s = buildStatement(m, m.people[0], l[0], NOW)
    expect(s.counted.paidHolidays).toBe(1)
    expect(s.counted.holidayHours).toBe(8)
    expect(s.counted.total).toBeCloseTo(s.counted.worked + 32 + 8 + 2, 5)
    expect(JSON.stringify(statementsDoc([s]).content)).toContain('Paid holidays: 1 × 8:00')
    expect(JSON.stringify(statementsDoc([plain]).content)).not.toContain('Paid holidays')
  })

  it('the pay row is Month · Pay\'s salary to the rupee, and its four parts always add up to it', () => {
    const owner = buildCardReport(model, lines, NOW)
    owner.people.forEach((c, i) => {
      const pay = c.pay!
      expect(pay.salary).toBe(Math.round(lines[i].pay as number))
      expect(pay.parts!.reduce((a, b) => a + b, 0)).toBe(pay.salary)
    })
    expect(owner.totals.pay!.salary).toBe(owner.people.reduce((s, c) => s + c.pay!.salary!, 0))
    expect(owner.totals.pay!.parts.reduce((a, b) => a + b, 0)).toBe(owner.totals.pay!.salary)
  })

  it('the hourly rate follows the days in the month, so the same salary is a different rate in October (it is priced from, never printed)', () => {
    const oct = buildMonthModel({ ym: '2026-10', employees: staff(1), records: [], overrides: [], overtime: [], today: '2026-11-01' })
    expect(buildPayLines(oct, rates(staff(1)), '2026-11-01')[0].hourly).toBeCloseTo(18000 / 248, 5)
    expect(buildPayLines(model, rates(people), '2026-10-01')[0].hourly).toBeCloseTo(18000 / 240, 5)
  })

  it('no salary and no hourly rate is printed on the cards', () => {
    const all = JSON.stringify(cardsDoc(buildCardReport(model, lines, NOW)).content)
    expect(all).not.toMatch(/18,000|18000|an hour|a month|75\.00/)
    expect(all).not.toMatch(/Monthly salary/i)
  })

  it('someone with no rate is left out of the pay row and said so, not shown as ₹0', () => {
    const l = buildPayLines(model, { ...rates(people), e1: [] }, '2026-10-01')
    const owner = buildCardReport(model, l, NOW)
    expect(owner.people[1].pay).toEqual({ parts: null, salary: null })
    expect(owner.totals.pay!.unrated).toBe(1)
    expect(JSON.stringify(cardsDoc(owner).content)).toContain('no salary set')
  })

  it('the statement\'s "hours counted" is exactly what Month · Pay counts, with overtime and paid Fridays shown apart', () => {
    const s = buildStatement(model, model.people[0], lines[0], NOW)
    expect(s.counted.worked).toBeCloseTo(lines[0].punchedHours, 5)
    expect(s.counted.fridayHours).toBe(32)
    expect(s.counted.overtime).toBe(2)
    expect(s.counted.total).toBeCloseTo(s.counted.worked + 32 + 2, 5)
    expect(s.counted.total).toBeCloseTo(lines[0].paidHours, 5)
    expect(s.leadBlanks).toBe(1)
  })
})

describe('what is printed says the right things', () => {
  const people = staff(2)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')
  it('names the shop, and makes no promise the owner has not made', () => {
    const all = JSON.stringify(cardsDoc(buildCardReport(model, lines, NOW))) + JSON.stringify(statementsDoc([buildStatement(model, model.people[0], lines[0], NOW)]))
    expect(all).toContain('UNITECH MACHINERIES')
    expect(all).not.toContain('Unitech Attendance')
    expect(all).not.toMatch(/within 7 days|looks wrong/)
  })

  it('the report is stamped for the owner and explains the total', () => {
    const all = JSON.stringify(cardsDoc(buildCardReport(model, lines, NOW)).content)
    expect(all).toContain('OWNER COPY')
    expect(all).toContain('Attendance and pay · September 2026')
    expect(all).toContain('Total = worked + Fridays + holiday + overtime')
    expect(all).toContain('₹')
  })
})

describe('what is pinned up never carries money', () => {
  const people = staff(5)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')

  it('the employee statements hold no rupee sign, salary, pay or payment wording', () => {
    const doc = statementsDoc(model.people.map((p, i) => buildStatement(model, p, lines[i], NOW)))
    const all = JSON.stringify(doc.content) + JSON.stringify((doc.footer as (a: number, b: number) => unknown)(1, 1))
    expect(all).not.toContain('₹')
    expect(all).not.toMatch(/salary|payment|balance|per hour|an hour|rate|owner copy/i)
    expect(all).not.toMatch(/18000|18,000/)
  })
})

describe('the PDF itself', () => {
  const people = staff(5)
  const model = month(people)
  const lines = buildPayLines(model, rates(people), '2026-10-01')

  it('draws the cards on one A4 portrait page for five people, with both fonts embedded', async () => {
    const pdf = await render(cardsDoc(buildCardReport(model, lines, NOW)))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(1)
    expect(pdf.length).toBeGreaterThan(8_000)
    expect(pdf.length).toBeLessThan(400_000)
    const raw = pdf.toString('latin1')
    expect(raw).toMatch(/Figtree/)
    expect(raw).toMatch(/IBMPlexMono/)
    expect(raw).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/) // A4 portrait
  })

  it('draws a month with a Friday worked, a docked Friday and a declared holiday on one page', async () => {
    const worked = { ...records([people[0]])[0], id: 'fri-work', date: '2026-09-11', clock_in: at('2026-09-11', 9), clock_out: at('2026-09-11', 11) }
    const m = buildMonthModel({
      ym: YM, employees: people, records: [...records(people), worked],
      overrides: [{ emp_id: 'e0', date: '2026-09-14', paid: true }, { emp_id: 'e2', date: '2026-09-18', paid: false }], overtime, today: '2026-10-01',
    })
    const l = buildPayLines(m, rates(people), '2026-10-01')
    expect(pageCount(await render(cardsDoc(buildCardReport(m, l, NOW))))).toBe(1)
  })

  it('continues onto more pages, with no card split across two, when there are too many people for one', async () => {
    const many = staff(14)
    const m = month(many)
    const l = buildPayLines(m, rates(many), '2026-10-01')
    expect(pageCount(await render(cardsDoc(buildCardReport(m, l, NOW))))).toBeGreaterThanOrEqual(2)
  })

  it('a month that needs six calendar rows (August 2026) still draws', async () => {
    const m = buildMonthModel({ ym: '2026-08', employees: staff(5), records: [], overrides: [], overtime: [], today: '2026-09-15' })
    const l = buildPayLines(m, rates(staff(5)), '2026-09-15')
    expect(pageCount(await render(cardsDoc(buildCardReport(m, l, NOW))))).toBeLessThanOrEqual(2)
  })

  it('draws one A4 portrait page per person, and a single person gives a single page', async () => {
    const all = model.people.map((p, i) => buildStatement(model, p, lines[i], NOW))
    expect(pageCount(await render(statementsDoc(all)))).toBe(5)
    const one = await render(statementsDoc([all[2]]))
    expect(pageCount(one)).toBe(1)
    expect(one.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/)
  })

  it('copes with a 31-day month and with no one in it', async () => {
    const m = buildMonthModel({ ym: '2026-10', employees: [], records: [], overrides: [], overtime: [], today: '2026-11-01' })
    expect(pageCount(await render(cardsDoc(buildCardReport(m, [], NOW))))).toBe(1)
  })
})
