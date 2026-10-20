import type { Content, ContentTable, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { fmtHours, fmtPrepared, type DayCode, type Statement } from './reportModel'

/**
 * The printed pages, drawn from the Timecard tokens (light theme, hex values from src/styles/tokens.css) and laid out as
 * the Report boards on the canvas. Everything here is hours and days: no money.
 * Differences from the boards, deliberate: an absent day is a solid tint with its letter rather than hatching (the PDF
 * library has no pattern fill), and the letters and tints are the whole legend, so a black-and-white print still reads.
 */
export const C = {
  ink: '#0f1a30', muted: '#4a5772', line: '#d7dde8', strong: '#7c879c', sunken: '#e9edf4',
} as const
export const TONE: Record<Exclude<DayCode, ''>, { bg: string; ink: string }> = {
  P: { bg: '#e3f5ea', ink: '#0a5c37' },
  H: { bg: '#fdebc8', ink: '#7a3b00' },
  A: { bg: '#f7c4ae', ink: '#7a2400' },
  F: { bg: '#ece5fb', ink: '#4e2f9e' },
  D: { bg: '#fdece4', ink: '#7a2400' },
  O: { bg: '#fff4dc', ink: '#7a3b00' },
}
export const MONO = 'PlexMono'

export const label = (text: string, extra: object = {}) => ({ text: text.toUpperCase(), font: MONO, fontSize: 6.5, characterSpacing: 0.5, color: C.muted, ...extra })

export const box = (stack: Content[]): Content => ({
  table: { widths: ['*'], body: [[{ stack, margin: [6, 5, 6, 5] }]] },
  layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => C.line, vLineColor: () => C.line },
})

export const footerLine = (left: string, right: string) => ({ margin: [30, 0, 30, 0], columns: [{ text: left, fontSize: 7.5, color: C.muted }, { text: right, fontSize: 7.5, color: C.muted, alignment: 'right' }] }) as Content

export const STATEMENT_NOTE = 'Each punch is counted to the nearest quarter hour, with up to 10 minutes of grace.'

/** One A4 portrait page per person, in the order given. The same builder serves one person and "everyone in one file". */
export function statementsDoc(list: Statement[]): TDocumentDefinitions {
  const first = list[0]
  const pages: Content[] = list.map((s, i) => {
    const weeks: TableCell[][] = []
    const flat: TableCell[] = [
      ...Array(s.leadBlanks).fill({ text: '' }),
      ...s.cells.map((c): TableCell => {
        if (!c.code) return { text: String(c.day), font: MONO, fontSize: 6.5, color: C.muted, margin: [4, 3, 0, 0] }
        const t = TONE[c.code]
        return {
          fillColor: t.bg,
          stack: [
            { text: String(c.day), font: MONO, fontSize: 6.5, color: C.muted, margin: [4, 3, 0, 0] },
            { text: c.code === 'F' || c.code === 'A' ? c.code : c.code === 'D' ? 'F' : c.code === 'O' ? '?' : c.hours === null ? '' : fmtHours(c.hours), font: MONO, bold: true, fontSize: 8, color: t.ink, alignment: 'right', margin: [0, 12, 4, 0] },
          ],
        }
      }),
    ]
    while (flat.length % 7) flat.push({ text: '' })
    for (let k = 0; k < flat.length; k += 7) weeks.push(flat.slice(k, k + 7))

    const row = (text: string, value: string, strong = false): TableCell[] => [
      { text, bold: strong, fontSize: 9.5, margin: [0, 5, 0, 5] },
      { text: value, font: MONO, bold: strong, fontSize: strong ? 12 : 9.5, alignment: 'right', margin: [0, strong ? 3 : 5, 0, 5] },
    ]
    const lines = (lastStrong: boolean) => ({
      hLineWidth: (i: number, node: ContentTable) => (lastStrong && i === node.table.body.length ? 1.5 : i === 0 ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i: number, node: ContentTable) => (i === node.table.body.length ? C.ink : C.line),
      paddingLeft: () => 0, paddingRight: () => 0,
    })

    return {
      pageBreak: i < list.length - 1 ? 'after' : undefined,
      stack: [
        {
          columns: [
            { stack: [label(s.shop), { text: 'Monthly attendance statement', bold: true, fontSize: 18, margin: [0, 2, 0, 0] }] },
            { width: 'auto', alignment: 'right', stack: [{ text: s.monthLabel, bold: true, fontSize: 14 }, label(s.rangeLabel, { alignment: 'right' })] },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 531, y2: 4, lineWidth: 1.5, lineColor: C.ink }], margin: [0, 2, 0, 12] },
        {
          columns: [
            { width: 38, table: { widths: [38], heights: [38], body: [[{ text: s.initials, bold: true, fontSize: 13, color: C.muted, fillColor: C.sunken, alignment: 'center', margin: [0, 11, 0, 0] }]] }, layout: 'noBorders' },
            { stack: [{ text: s.name, bold: true, fontSize: 16 }, { text: s.since ? `Employee since ${s.since} · weekly holiday on Friday` : 'Weekly holiday on Friday', fontSize: 8.5, color: C.muted, margin: [0, 2, 0, 0] }], margin: [10, 3, 0, 0] },
          ],
          margin: [0, 0, 0, 12],
        },
        {
          columns: [
            box([label('Days worked'), { text: String(s.tiles.daysWorked), font: MONO, fontSize: 15 }]),
            box([label('Absent'), { text: String(s.tiles.absent), font: MONO, fontSize: 15 }]),
            box([label('Half days'), { text: String(s.tiles.halfDays), font: MONO, fontSize: 15 }]),
            box([label('Hours worked'), { text: fmtHours(s.tiles.hoursWorked), font: MONO, fontSize: 15 }]),
          ],
          columnGap: 8,
          margin: [0, 0, 0, 14],
        },
        { text: 'Your attendance', bold: true, fontSize: 10, margin: [0, 0, 0, 5] },
        {
          table: {
            widths: Array(7).fill('*'),
            heights: (r: number) => (r === 0 ? 16 : 51),
            body: [
              ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d): TableCell => ({ text: d, font: MONO, bold: true, fontSize: 6.5, color: C.muted, alignment: 'center', fillColor: C.sunken, margin: [0, 4, 0, 0] })),
              ...weeks,
            ],
          },
          layout: { hLineWidth: (i: number) => (i === 1 ? 1 : 0.5), vLineWidth: () => 0.5, hLineColor: (i: number) => (i === 1 ? C.strong : C.line), vLineColor: () => C.line, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
        },
        {
          margin: [0, 5, 0, 14],
          fontSize: 7.5,
          color: C.muted,
          text: [
            'Numbers are hours worked that day   ·   H half day   ·   A absent   ·   F weekly holiday, paid',
            ...(s.cells.some((c) => c.code === 'D') ? ['   ·   F in red: a Friday not paid'] : []),
            ...(s.hasOpen ? ['   ·   ? no clock-out yet'] : []),
            ...(s.counted.overtime > 0 ? [`   ·   Overtime of ${fmtHours(s.counted.overtime)} is added below`] : []),
          ],
        },
        { text: 'How your hours are counted', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              row('Hours worked, from your punches', fmtHours(s.counted.worked)),
              row(`Paid Fridays: ${s.counted.paidFridays} weekly ${s.counted.paidFridays === 1 ? 'holiday' : 'holidays'} × 8:00`, `+ ${fmtHours(s.counted.fridayHours)}`),
              row('Overtime added by the owner', s.counted.overtime > 0 ? `+ ${fmtHours(s.counted.overtime)}` : '0:00'),
              row(`Hours counted for ${s.monthLabel.split(' ')[0]}`, fmtHours(s.counted.total), true),
            ],
          },
          layout: lines(true),
        },
      ],
    }
  })

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [32, 28, 32, 74],
    defaultStyle: { font: 'Figtree', fontSize: 9, color: C.ink },
    info: { title: list.length === 1 ? `Attendance statement, ${first.name}, ${first.monthLabel}` : `Attendance statements, ${first.monthLabel}`, author: first.shop },
    footer: (page, pages) =>
      ({
        margin: [32, 0, 32, 0],
        stack: [
          { columns: [{ text: 'Employee: ______________________________   Date: ____________', fontSize: 8, color: C.muted }, { text: 'Owner: ______________________________', fontSize: 8, color: C.muted, alignment: 'right' }], margin: [0, 0, 0, 8] },
          { columns: [{ text: STATEMENT_NOTE, fontSize: 7, color: C.muted, width: 380 }, { text: `Prepared ${fmtPrepared(first.preparedAt)} · Page ${page} of ${pages}`, fontSize: 7, color: C.muted, alignment: 'right' }] },
        ],
      }) as Content,
    content: pages,
  }
}
