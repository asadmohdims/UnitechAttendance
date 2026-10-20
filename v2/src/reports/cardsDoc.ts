import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { fmtCurrency } from '@legacy/salary.js'
import { C, MONO, TONE } from './reportDocs'
import { fmtHours, fmtPrepared, type CardReport, type DayCode, type Hours, type Parts, type PersonCard, type ReportCell } from './reportModel'

/**
 * The owner's Attendance and pay report: A4 portrait, two cards across, one calendar card per person (their month, the
 * hours worked each day, the sum of their hours: worked + Fridays + holidays + overtime, and under it that sum priced at
 * their own hourly rate, ending in their salary). The salary and the hourly rate themselves are not printed. Laid out as the "Report · Attendance and pay, owner copy" board on the canvas. Owner only: it carries money,
 * so it is stamped and is never the page that gets pinned up (the employee statements are).
 * Differences from the boards, deliberate: an absent day is a solid tint with its letter rather than hatching, and a
 * docked Friday is a pale red with a struck-through F rather than an outlined cell (the PDF library has no pattern fill
 * and no per-cell outline), so the letters and tints are the whole legend and a black-and-white print still reads.
 */
const PAGE = { w: 595.28, margin: [28, 26, 28, 34] as [number, number, number, number] }
const GAP = 9
const CARD_W = (PAGE.w - PAGE.margin[0] - PAGE.margin[2] - GAP) / 2
const INNER_W = CARD_W - 2 * 7 - 2 // card padding and its 1pt border
// pdfmake rewrites a table's widths array in place, so every table gets its own copy of this one.
const EQ_WIDTHS = [0.15, 0.03, 0.15, 0.03, 0.15, 0.03, 0.15, 0.03, 0.28].map((f) => Math.floor(f * INNER_W * 10) / 10)
const WHITE = '#ffffff'
/** pdfmake's own types are a closed union that rejects spreads and extra keys, so layout pieces are plain objects, cast once at the document. */
type N = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const tiny = (text: string, extra: object = {}): N => ({ text: text.toUpperCase(), font: MONO, fontSize: 5.6, characterSpacing: 0.4, color: C.muted, ...extra })
const noBorders = { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }
const rule = (width: number, lineWidth = 0.5, dash = false, color: string = C.strong): N => ({
  canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth, lineColor: color, ...(dash ? { dash: { length: 2 } } : {}) }],
})
const op = (t: string, top = 1): N => ({ text: t, font: MONO, fontSize: 8, color: C.muted, alignment: 'center', margin: [0, top, 0, 0] })

/** Two letters for the avatar chip: first and last name, or the first two letters of a single name. */
const initials2 = (name: string): string => {
  const w = name.trim().split(/\s+/)
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : name.trim().slice(0, 2)).toUpperCase()
}

/** F, PH and D with hours mean the person came in: the cell shows the hours worked on top of the 8:00. */
const cameIn = (c: ReportCell) => (c.code === 'F' || c.code === 'PH' || c.code === 'D') && !!c.hours
const dayText = (c: ReportCell): string =>
  cameIn(c) ? `+${fmtHours(c.hours as number)}` : c.code === 'D' ? 'F' : c.code === 'F' || c.code === 'PH' || c.code === 'A' ? c.code : c.code === 'O' ? '?' : c.hours === null ? '' : fmtHours(c.hours)

function dayCell(c: ReportCell): N {
  if (!c.code) return { text: String(c.day), font: MONO, fontSize: 5.6, color: C.muted, margin: [2, 1, 0, 0] }
  const t = TONE[c.code]
  return {
    fillColor: t.bg,
    stack: [
      { text: cameIn(c) ? `${c.day} ${c.code === 'D' ? 'F' : c.code}` : String(c.day), font: MONO, fontSize: 5.6, color: C.muted, margin: [2, 1, 0, 0] },
      { text: dayText(c), font: MONO, bold: true, fontSize: 6.8, color: t.ink, alignment: 'right', margin: [0, 0, 2.5, 0], ...(c.code === 'D' ? { decoration: 'lineThrough' } : {}) },
    ],
  }
}

function calendar(cells: ReportCell[], lead: number): N {
  const flat: N[] = [...Array(lead).fill({ text: '' }), ...cells.map(dayCell)]
  while (flat.length % 7) flat.push({ text: '' })
  const weeks: N[][] = []
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7))
  const head = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i): N => ({ text: d, font: MONO, bold: true, fontSize: 5.8, color: i === 4 ? TONE.F.ink : C.muted, fillColor: i === 4 ? TONE.F.bg : C.sunken, alignment: 'center', margin: [0, 2, 0, 1] }))
  return {
    table: { widths: Array(7).fill('*'), heights: (row: number) => (row === 0 ? 11 : 20), body: [head, ...weeks] },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 1 ? 1 : i === 0 || i === node.table.body.length ? 0.5 : 0.5),
      vLineWidth: () => 0.5,
      hLineColor: (i: number) => (i === 1 ? C.strong : C.line),
      vLineColor: () => C.line,
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
  }
}

/** Worked + Fridays + Holiday + Overtime = Total, each figure under its label. */
function hoursRow(h: Hours): N {
  const val = (x: number, extra: object = {}): N => ({ text: fmtHours(x), font: MONO, fontSize: 8.5, ...extra })
  return {
    table: {
      widths: [...EQ_WIDTHS],
      body: [
        [tiny('Worked'), '', tiny('Fridays'), '', tiny('Holiday'), '', tiny('Overtime'), '', { stack: [rule(EQ_WIDTHS[8] - 2, 1.5, false, C.ink), tiny('Total', { color: C.ink, margin: [0, 1, 0, 0] })] }],
        [val(h.worked), op('+'), val(h.fridays), op('+'), val(h.holidays, h.holidays ? {} : { color: C.muted }), op('+'), val(h.overtime, h.overtime ? {} : { color: C.muted }), op('='), val(h.total, { bold: true, fontSize: 10 })],
      ],
    },
    layout: noBorders,
  }
}

/** The same columns priced at the person's hourly rate; the dark box at the end is their salary. */
function payRow(parts: Parts | null, salary: number | null, salaryLabel = 'Salary'): N {
  const money = (x: number | null): N => ({ text: x === null ? '—' : fmtCurrency(x), font: MONO, fontSize: 8, margin: [0, 5, 0, 0] })
  return {
    stack: [
      rule(INNER_W, 0.5, true),
      {
        margin: [0, 3, 0, 0],
        table: {
          widths: [...EQ_WIDTHS],
          body: [[
            money(parts?.[0] ?? null), op('+', 5.5), money(parts?.[1] ?? null), op('+', 5.5), money(parts?.[2] ?? null), op('+', 5.5), money(parts?.[3] ?? null), op('=', 5.5),
            { fillColor: C.ink, margin: [3, 2, 4, 3], stack: [{ text: salary === null ? 'NO RATE' : salaryLabel.toUpperCase(), font: MONO, fontSize: 4.8, characterSpacing: 0.5, color: WHITE, alignment: 'right' }, { text: salary === null ? 'set' : fmtCurrency(salary), font: MONO, bold: true, fontSize: 10.5, color: WHITE, alignment: 'right' }] },
          ]],
        },
        layout: noBorders,
      },
    ],
  }
}

// No fill on a card, deliberately: pdfmake paints a card's own fill over the dark salary box inside it.
const card = (stack: N[]): N => ({
  table: { widths: ['*'], body: [[{ stack, margin: [7, 6, 7, 6] }]] },
  layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => C.strong, vLineColor: () => C.strong },
})

function personCard(p: PersonCard, r: CardReport): N {
  return card([
    {
      columns: [
        { width: 20, table: { widths: [20], heights: [20], body: [[{ text: initials2(p.name), font: MONO, bold: true, fontSize: 7, color: C.muted, fillColor: C.sunken, alignment: 'center', margin: [0, 6, 0, 0] }]] }, layout: noBorders },
        { width: '*', text: p.name, bold: true, fontSize: 11.5, margin: [6, 3, 0, 0] },
      ],
      margin: [0, 0, 0, 4],
    },
    calendar(p.cells, r.leadBlanks),
    { ...hoursRow(p.hours), margin: [0, 5, 0, 0] },
    { ...payRow(p.pay.parts, p.pay.salary), margin: [0, 5, 0, 0] },
  ])
}

const SWATCH: { code: Exclude<DayCode, ''>; text: string; label: string }[] = [
  { code: 'P', label: '8:00', text: 'Present: hours worked that day' },
  { code: 'H', label: '4:00', text: 'Half day' },
  { code: 'A', label: 'A', text: 'Absent' },
  { code: 'F', label: 'F', text: 'Friday, the weekly holiday, paid 8:00' },
  { code: 'PH', label: 'PH', text: 'Paid holiday, 8:00' },
  { code: 'F', label: '+2:00', text: 'Came in on a holiday (F or PH): 8:00 paid plus the hours' },
  { code: 'D', label: 'F', text: 'Holiday docked: not paid, not counted' },
]

function glance(r: CardReport): N {
  const items = r.totals.pay.unrated
  const legend: N[][] = [
    ...SWATCH.map((s): N[] => [
      { text: s.label, font: MONO, bold: true, fontSize: 6, color: TONE[s.code].ink, fillColor: TONE[s.code].bg, alignment: 'center', margin: [0, 2, 0, 1.5], ...(s.code === 'D' ? { decoration: 'lineThrough' } : {}) },
      { text: s.text, fontSize: 7.5, color: C.muted, margin: [6, 2, 0, 0] },
    ]),
    ...(r.hasOpen ? [[{ text: '?', font: MONO, bold: true, fontSize: 6, color: TONE.O.ink, fillColor: TONE.O.bg, alignment: 'center', margin: [0, 2, 0, 1.5] }, { text: 'No clock-out yet', fontSize: 7.5, color: C.muted, margin: [6, 2, 0, 0] }]] : []),
  ]
  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
  return card(
    [
      tiny('The month at a glance, everyone', { margin: [0, 0, 0, 5] }),
      hoursRow(r.totals.hours),
      { ...payRow(r.totals.pay.parts, r.totals.pay.salary, 'Total salary'), margin: [0, 5, 0, 0] },
      ...(items ? [{ text: `Left out of the pay row: ${items} ${items === 1 ? 'person has' : 'people have'} no salary set.`, fontSize: 7, color: C.muted, margin: [0, 4, 0, 0] }] : []),
      ...(r.holidayDates.length ? [{ text: [{ text: r.holidayDates.length === 1 ? 'Paid holiday' : 'Paid holidays', bold: true }, ` · ${r.holidayDates.map(dayLabel).join(', ')} · 8:00 each`], fontSize: 7.5, color: TONE.F.ink, fillColor: TONE.F.bg, margin: [0, 6, 0, 0] }] : []),
      tiny('How to read a day', { margin: [0, 9, 0, 4] }),
      { table: { widths: [26, '*'], body: legend }, layout: { ...noBorders, hLineWidth: () => 0, paddingBottom: () => 3 } },
      { text: 'Hours are counted to the nearest quarter hour. Total = worked + Fridays + holiday + overtime. Worked includes hours worked on a holiday.', fontSize: 7, color: C.muted, margin: [0, 4, 0, 0], lineHeight: 1.2 },
    ],
  )
}

/** A4 portrait, two cards across. A card is never split between pages; more people continue on the next page. */
export function cardsDoc(r: CardReport): TDocumentDefinitions {
  const cells: N[] = [...r.people.map((p) => personCard(p, r)), glance(r)]
  const rows: N[] = []
  for (let i = 0; i < cells.length; i += 2) {
    rows.push({ columns: [cells[i], cells[i + 1] ?? { text: '' }], columnGap: GAP, unbreakable: true, margin: [0, 0, 0, GAP] })
  }
  const title = `Attendance and pay · ${r.monthLabel}`
  const right: N[] = [
    { text: 'OWNER COPY · NOT FOR STAFF', font: MONO, bold: true, fontSize: 6.5, characterSpacing: 0.5, color: '#7a2400', background: '#f7c4ae', alignment: 'right' },
    { text: `${r.people.length} ${r.people.length === 1 ? 'person' : 'people'} · ${r.daysInMonth} days · Prepared ${fmtPrepared(r.preparedAt)}`, fontSize: 7.5, color: C.muted, alignment: 'right', margin: [0, 4, 0, 0] },
  ]
  const foot = (left: string, rightText: string) => (page: number, pages: number): N => ({
    margin: [PAGE.margin[0], 0, PAGE.margin[2], 0],
    columns: [{ text: left, fontSize: 7.5, color: C.muted }, { text: `${rightText} · Page ${page} of ${pages}`, fontSize: 7.5, color: C.muted, alignment: 'right' }],
  })
  return {
    pageSize: 'A4',
    pageMargins: PAGE.margin,
    defaultStyle: { font: 'Figtree', fontSize: 9, color: C.ink },
    info: { title: `${title}`, author: r.shop },
    footer: foot('Approved by the owner: ______________________   Date: ____________', `${r.monthLabel} · Owner copy`) as unknown as TDocumentDefinitions['footer'],
    content: [
      {
        columns: [
          { width: '*', stack: [{ text: r.shop.toUpperCase(), font: MONO, fontSize: 6.5, characterSpacing: 0.5, color: C.muted }, { text: title, bold: true, fontSize: 17, margin: [0, 1, 0, 0] }] },
          { width: 'auto', stack: right },
        ],
        margin: [0, 0, 0, 5],
      },
      { ...rule(PAGE.w - PAGE.margin[0] - PAGE.margin[2], 1.5, false, C.ink), margin: [0, 0, 0, 8] },
      ...rows,
    ] as Content[],
  } as TDocumentDefinitions
}
