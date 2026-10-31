import type { Content, ContentTable, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { fmtClock, fmtHours, fmtPrepared, type DayCode, type LogRow, type Statement } from './reportModel'

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
  PH: { bg: '#d9ccf5', ink: '#4e2f9e' },
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

export const STATEMENT_NOTE = 'Times shown are your kiosk punches counted to the nearest quarter hour, with up to 10 minutes of grace.'

/** The daily log's columns (pt): day, four times, hours, total. The hours column takes what is left of the right-hand column. */
const LOG_WIDTHS = [36, 39, 39, 39, 39, '*', 40]
const ROW_H = 17
const ROW_H_TWO_LINES = 24

const head = (text: string, extra: object = {}): TableCell => ({ text, font: MONO, bold: true, fontSize: 5.5, characterSpacing: 0.4, color: C.muted, alignment: 'center', fillColor: C.sunken, margin: [0, 3, 0, 0], ...extra })

/** The "Worked" column's extras, one line under the hours: the standard day a Friday or holiday earns, overtime, a third or later stretch. */
function extrasOf(r: LogRow): string {
  const parts: string[] = []
  r.spans.slice(2).forEach((s) => parts.push(`+ ${fmtHours(s.hours)} (${fmtClock(s.inMs)} to ${s.outMs === null ? '…' : fmtClock(s.outMs)})`))
  if (r.credit && r.credit.hours > 0) parts.push(`+ ${fmtHours(r.credit.hours)} ${r.credit.kind === 'friday' ? 'Friday' : 'holiday'}`)
  if (r.overtime > 0) parts.push(`+ ${fmtHours(r.overtime)} overtime`)
  return parts.join('  ')
}

/** Tint of a whole row: a paid standard day, a docked one, an absence. Worked days carry none. */
function rowTint(r: LogRow): string | undefined {
  if (r.kind === 'absent') return TONE.A.bg
  if (r.kind === 'holiday') return r.credit?.docked ? TONE.D.bg : r.credit?.kind === 'holiday' ? TONE.PH.bg : TONE.F.bg
  return undefined
}

function logRow(r: LogRow): { cells: TableCell[]; height: number } {
  const fillColor = rowTint(r)
  const f = (c: object): TableCell => ({ ...(fillColor ? { fillColor } : {}), ...c }) as TableCell
  const dayCell = f({ text: [{ text: String(r.day), font: MONO, bold: true, fontSize: 8.5, color: r.kind === 'none' ? C.muted : C.ink }, { text: ` ${r.weekday.toUpperCase()}`, font: MONO, fontSize: 6, color: C.muted }], margin: [4, 4, 0, 0] })

  if (r.kind === 'holiday' && r.spans.length === 0) {
    const docked = r.credit?.docked
    const note = r.credit?.kind === 'holiday' ? (docked ? 'Holiday, not paid' : 'Paid holiday') : docked ? 'Weekly holiday, not paid' : 'Weekly holiday, paid'
    const ink = docked ? TONE.D.ink : TONE.F.ink
    return { height: ROW_H, cells: [dayCell, f({ text: note, colSpan: 4, fontSize: 8, color: ink, margin: [6, 4.5, 0, 0] }), {}, {}, {}, f({ text: '' }), f({ text: docked ? '—' : fmtHours(r.total ?? 0), font: MONO, bold: true, fontSize: 9, alignment: 'right', margin: [0, 4, 4, 0] })] }
  }
  if (r.kind === 'absent') {
    return { height: ROW_H, cells: [dayCell, f({ text: 'Absent', colSpan: 4, fontSize: 8, color: TONE.A.ink, margin: [6, 4.5, 0, 0] }), {}, {}, {}, f({ text: '' }), f({ text: '—', font: MONO, bold: true, fontSize: 9, alignment: 'right', margin: [0, 4, 4, 0] })] }
  }
  if (r.spans.length === 0) return { height: ROW_H, cells: [dayCell, ...Array(5).fill(f({ text: '' })), f({ text: '' })] }

  const time = (ms: number | null | undefined): TableCell => f({ text: ms == null ? '' : fmtClock(ms), font: MONO, fontSize: 9, alignment: 'center', margin: [0, 4, 0, 0] })
  const [a, b] = r.spans
  const open = r.spans.some((s) => s.outMs === null)
  // One stretch only: say why the afternoon is empty when there is a reason (a half day; a lunch paid through).
  const afternoonNote = !b && (r.kind === 'half' ? 'Half day' : r.lunchPaid ? 'Lunch paid' : '')
  const afternoon: TableCell[] = b ? [time(b.inMs), time(b.outMs)] : afternoonNote ? [f({ text: afternoonNote, colSpan: 2, fontSize: 8, color: C.muted, alignment: 'center', margin: [0, 4.5, 0, 0] }), {}] : [time(null), time(null)]
  const extras = extrasOf(r)
  const hoursText = open ? 'No clock-out yet' : r.spans.slice(0, 2).map((s) => fmtHours(s.hours)).join(' + ')
  const worked = f({
    stack: [{ text: hoursText, font: open ? undefined : MONO, fontSize: open ? 7.5 : 8, color: open ? C.muted : C.ink, alignment: 'center' }, ...(extras ? [{ text: extras, fontSize: 6, color: C.muted, alignment: 'center' }] : [])],
    margin: [0, extras ? 2 : 4.5, 0, 0],
  })
  const total = f({ text: r.total === null ? '' : fmtHours(r.total), font: MONO, bold: true, fontSize: 9, alignment: 'right', margin: [0, 4, 4, 0] })
  return { height: extras ? ROW_H_TWO_LINES : ROW_H, cells: [dayCell, time(a.inMs), time(a.outMs), ...afternoon, worked, total] }
}

function logTable(log: LogRow[]): Content {
  const rows = log.map(logRow)
  return {
    table: {
      widths: LOG_WIDTHS,
      heights: (i: number) => (i < 2 ? 11 : rows[i - 2].height),
      body: [
        [head(''), head('MORNING', { colSpan: 2 }), {}, head('AFTERNOON', { colSpan: 2 }), {}, head(''), head('')],
        [head('DAY'), head('IN'), head('OUT'), head('IN'), head('OUT'), head('WORKED'), head('TOTAL', { alignment: 'right', margin: [0, 3, 4, 0] })],
        ...rows.map((r) => r.cells),
      ],
    },
    layout: {
      hLineWidth: (i: number) => (i === 2 ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i: number) => (i === 2 ? C.strong : C.line),
      paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
  }
}

/** One A4 portrait page per person, in the order given. The same builder serves one person and "everyone in one file". */
export function statementsDoc(list: Statement[]): TDocumentDefinitions {
  const first = list[0]
  const pages: Content[] = list.map((s, i) => {
    const weeks: TableCell[][] = []
    const flat: TableCell[] = [
      ...Array(s.leadBlanks).fill({ text: '' }),
      ...s.cells.map((c): TableCell => {
        if (!c.code) return { text: String(c.day), font: MONO, fontSize: 5.5, color: C.muted, margin: [2, 2, 0, 0] }
        const t = TONE[c.code]
        return {
          fillColor: t.bg,
          stack: [
            { text: String(c.day), font: MONO, fontSize: 5.5, color: C.muted, margin: [2, 2, 0, 0] },
            { text: c.code === 'A' ? c.code : c.code === 'F' || c.code === 'PH' || c.code === 'D' ? (c.hours ? `+${fmtHours(c.hours)}` : c.code === 'D' ? 'F' : c.code) : c.code === 'O' ? '?' : c.hours === null ? '' : fmtHours(c.hours), font: MONO, bold: true, fontSize: 7, color: t.ink, alignment: 'right', margin: [0, 8, 2, 0] },
          ],
        }
      }),
    ]
    while (flat.length % 7) flat.push({ text: '' })
    for (let k = 0; k < flat.length; k += 7) weeks.push(flat.slice(k, k + 7))

    const row = (text: string, value: string, strong = false): TableCell[] => [
      { text, bold: strong, fontSize: 8.5, margin: [0, 4, 0, 4] },
      { text: value, font: MONO, bold: strong, fontSize: strong ? 10.5 : 8.5, alignment: 'right', margin: [0, strong ? 3 : 4, 0, 4] },
    ]
    const lines = (lastStrong: boolean) => ({
      hLineWidth: (i: number, node: ContentTable) => (lastStrong && i === node.table.body.length ? 1.5 : i === 0 ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i: number, node: ContentTable) => (i === node.table.body.length ? C.ink : C.line),
      paddingLeft: () => 0, paddingRight: () => 0,
    })
    const tile = (name: string, value: string) => box([label(name), { text: value, font: MONO, fontSize: 13 }])
    const monthName = s.monthLabel.split(' ')[0]

    const left: Content[] = [
      { text: 'Your attendance', bold: true, fontSize: 9.5, margin: [0, 0, 0, 4] },
      {
        table: {
          widths: Array(7).fill(27),
          heights: (r: number) => (r === 0 ? 12 : 28),
          body: [
            ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d): TableCell => ({ text: d, font: MONO, bold: true, fontSize: 5.5, color: C.muted, alignment: 'center', fillColor: C.sunken, margin: [0, 3, 0, 0] })),
            ...weeks,
          ],
        },
        layout: { hLineWidth: (i: number) => (i === 1 ? 1 : 0.5), vLineWidth: () => 0.5, hLineColor: (i: number) => (i === 1 ? C.strong : C.line), vLineColor: () => C.line, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      },
      {
        margin: [0, 4, 0, 10],
        fontSize: 6.5,
        color: C.muted,
        text: [
          'Hours worked that day   ·   H half day   ·   A absent   ·   F weekly holiday, paid',
          ...(s.cells.some((c) => c.code === 'PH') ? ['   ·   PH paid holiday'] : []),
          ...(s.cells.some((c) => c.code === 'F' || c.code === 'PH' ? c.hours : false) ? ['   ·   +2:00 came in on a holiday'] : []),
          ...(s.cells.some((c) => c.code === 'D') ? ['   ·   F in red: a holiday not paid'] : []),
          ...(s.hasOpen ? ['   ·   ? no clock-out yet'] : []),
        ],
      },
      { columns: [tile('Days worked', String(s.tiles.daysWorked)), tile('Absent', String(s.tiles.absent))], columnGap: 6, margin: [0, 0, 0, 6] },
      { columns: [tile('Half days', String(s.tiles.halfDays)), tile('Hours worked', fmtHours(s.tiles.hoursWorked))], columnGap: 6, margin: [0, 0, 0, 12] },
      { text: 'How your hours are counted', bold: true, fontSize: 9.5, margin: [0, 0, 0, 2] },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            row('Worked, from your punches', fmtHours(s.counted.worked)),
            row(`Paid Fridays, ${s.counted.paidFridays} × 8:00`, `+ ${fmtHours(s.counted.fridayHours)}`),
            ...(s.counted.paidHolidays > 0 ? [row(`Paid holidays, ${s.counted.paidHolidays} × 8:00`, `+ ${fmtHours(s.counted.holidayHours)}`)] : []),
            row('Overtime from the owner', s.counted.overtime > 0 ? `+ ${fmtHours(s.counted.overtime)}` : '0:00'),
            row(`Counted for ${monthName}`, fmtHours(s.counted.total), true),
          ],
        },
        layout: lines(true),
      },
      { text: 'The Total column of the daily log adds up to this.', fontSize: 6.5, color: C.muted, margin: [0, 4, 0, 0] },
    ]

    return {
      pageBreak: i < list.length - 1 ? 'after' : undefined,
      stack: [
        {
          columns: [
            { stack: [label(s.shop), { text: 'Monthly attendance statement', bold: true, fontSize: 16.5, margin: [0, 2, 0, 0] }] },
            { width: 'auto', alignment: 'right', stack: [{ text: s.monthLabel, bold: true, fontSize: 13.5 }, label(s.rangeLabel, { alignment: 'right' })] },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 531, y2: 4, lineWidth: 1.5, lineColor: C.ink }], margin: [0, 2, 0, 9] },
        {
          columns: [
            { width: 33, table: { widths: [33], heights: [33], body: [[{ text: s.initials, bold: true, fontSize: 12, color: C.muted, fillColor: C.sunken, alignment: 'center', margin: [0, 9, 0, 0] }]] }, layout: 'noBorders' },
            { stack: [{ text: s.name, bold: true, fontSize: 15 }, { text: s.since ? `Employee since ${s.since} · weekly holiday on Friday` : 'Weekly holiday on Friday', fontSize: 9, color: C.muted, margin: [0, 1, 0, 0] }], margin: [9, 2, 0, 0] },
          ],
          margin: [0, 0, 0, 9],
        },
        {
          columns: [
            { width: 189, stack: left },
            { width: '*', stack: [{ text: 'Your daily log', bold: true, fontSize: 9.5, margin: [0, 0, 0, 4] }, logTable(s.log)] },
          ],
          columnGap: 15,
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
