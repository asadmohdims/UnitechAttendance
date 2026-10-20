import type { Content, ContentTable, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { C, footerLine, label, MONO } from './reportDocs'
import { fmtPrepared } from './reportModel'
import type { PayrollRow, PayrollSummary } from './payrollModel'

/**
 * The owner's payroll summary, A4 landscape, laid out as the "Report · Payroll summary" board on the canvas.
 * It is the one printed report with money on it, so every page says "Owner copy · not for staff".
 */
const ALERT = { bg: '#f7c4ae', ink: '#7a2400' }
const ATTENTION = { wash: '#fff4dc', line: '#e0a526', ink: '#7a3b00' }
const COLS = [126, 68, 44, 64, 62, 54, 64, 58, 72, 72, 94]
const HEADS = ['Employee', 'Monthly salary', 'Days worked', 'Hours worked', 'Paid Fridays', 'Overtime', 'Hours paid', 'Per hour', 'Pay', 'Paid out', 'Balance']

const num = (text: string, extra: Record<string, unknown> = {}): TableCell => ({ text, font: MONO, fontSize: 8.5, alignment: 'right', margin: [0, 8, 5, 8], ...extra }) as TableCell

function balanceCell(r: Pick<PayrollRow, 'balance' | 'balanceLabel' | 'tone'>): TableCell {
  return {
    margin: [0, 5, 5, 5],
    stack: [
      { text: r.balance, font: MONO, bold: true, fontSize: 8.5, alignment: 'right' },
      { text: r.balanceLabel.toUpperCase(), font: MONO, fontSize: 5.8, characterSpacing: 0.4, alignment: 'right', color: r.tone === 'ahead' ? ATTENTION.ink : C.muted },
    ],
  }
}

export function payrollDoc(s: PayrollSummary): TDocumentDefinitions {
  const head = HEADS.map((h, i): TableCell => ({ text: h.toUpperCase(), font: MONO, bold: true, fontSize: 6, color: C.muted, alignment: i === 0 ? 'left' : 'right', fillColor: C.sunken, margin: [i === 0 ? 5 : 0, 7, 5, 6] }))
  const body: TableCell[][] = [
    head,
    ...s.rows.map((r): TableCell[] => [
      { text: r.name, bold: true, fontSize: 10, margin: [5, 7, 0, 7] },
      num(r.salary), num(r.days), num(r.worked), num(r.fridays), num(r.overtime), num(r.paidHours), num(r.perHour), num(r.pay, { bold: true }), num(r.paidOut), balanceCell(r),
    ]),
    [
      { text: 'Total', bold: true, fontSize: 10, margin: [5, 7, 0, 7], fillColor: C.sunken },
      ...[s.totals.salary, s.totals.days, s.totals.worked, s.totals.fridays, s.totals.overtime, s.totals.paidHours, '', s.totals.pay, s.totals.paidOut].map((t) => num(t, { bold: true, fillColor: C.sunken })),
      { ...(balanceCell({ balance: s.totals.toPay, balanceLabel: 'still to pay', tone: 'owing' }) as object), fillColor: C.sunken } as TableCell,
    ],
  ]
  const lastRow = body.length - 1

  const noteBox = (title: string, lines: string[], tone: 'plain' | 'attention'): TableCell => {
    const stack: Content[] = [
      label(title, { color: tone === 'attention' ? ATTENTION.ink : C.muted, margin: [0, 0, 0, 3] }) as Content,
      ...(tone === 'attention' && lines.length > 1 ? [{ ul: lines, fontSize: 8, lineHeight: 1.25 }] : lines.map((t): Content => ({ text: t, fontSize: 8, lineHeight: 1.25, margin: [0, 0, 0, 3] }))),
    ]
    return { margin: [8, 6, 8, 6], stack, ...(tone === 'attention' ? { fillColor: ATTENTION.wash } : {}) }
  }
  const how = [
    `Per hour is the monthly salary divided by the hours in the month: ${s.standardHoursText}. Hours paid are hours worked, plus a paid day's hours for each paid Friday, plus overtime. Pay is per hour times hours paid, to the nearest rupee. Each punch counts to the nearest quarter hour, with up to 10 minutes of grace.`,
    'Paid out is what you entered in Payments for the month. Balance is pay less paid out. What employees entered themselves is not counted here.',
  ]
  const notes = s.notes.length ? s.notes : ['Nothing needs your attention.']
  const boxLayout = (line: string) => ({ hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => line, vLineColor: () => line })

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 28, 30, 36],
    defaultStyle: { font: 'Figtree', fontSize: 9, color: C.ink },
    info: { title: `Payroll summary, ${s.monthLabel}`, author: s.shop },
    footer: () => footerLine('Approved by the owner: ______________________   Date: ______________', `${s.shop} · ${s.monthLabel} · Payroll summary · Owner copy`),
    content: [
      {
        columns: [
          { stack: [label(s.shop), { text: `Payroll summary · ${s.monthLabel}`, bold: true, fontSize: 20, margin: [0, 2, 0, 0] }] },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: 'OWNER COPY · NOT FOR STAFF', font: MONO, bold: true, fontSize: 6.5, characterSpacing: 0.5, color: ALERT.ink, background: ALERT.bg },
              { text: `Prepared ${fmtPrepared(s.preparedAt)}`, fontSize: 8, color: C.muted, margin: [0, 4, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 10],
      },
      {
        table: { headerRows: 1, widths: COLS, body },
        layout: {
          hLineWidth: (i: number, node: ContentTable) => (i === 0 || i === node.table.body.length ? 1 : i === lastRow ? 1.5 : i === 1 ? 1 : 0.5),
          vLineWidth: (i: number, node: ContentTable) => (i === 0 || i === (node.table.widths as unknown[]).length ? 1 : 0),
          hLineColor: (i: number) => (i === 0 || i === 1 || i === lastRow ? C.ink : C.line),
          vLineColor: () => C.strong,
          paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
        },
      },
      {
        columns: [
          { width: '56%', unbreakable: true, table: { widths: ['*'], body: [[noteBox('How pay is worked out', how, 'plain')]] }, layout: boxLayout(C.line) },
          { width: '*', unbreakable: true, table: { widths: ['*'], body: [[noteBox('Needs your attention', notes, 'attention')]] }, layout: boxLayout(ATTENTION.line) },
        ],
        columnGap: 10,
        margin: [0, 12, 0, 0],
      },
    ],
  }
}
