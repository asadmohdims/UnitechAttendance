import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { canShareFiles, saveFile, shareOrSave } from '../../reports/deliver'
import { renderPdf } from '../../reports/makePdf'
import { payrollDoc } from '../../reports/payrollDoc'
import { buildPayrollSummary } from '../../reports/payrollModel'
import { attendanceDoc, statementsDoc } from '../../reports/reportDocs'
import { buildAttendanceReport, buildStatement } from '../../reports/reportModel'
import { STANDARD_DAY_HOURS } from '@legacy/config.js'
import type { Payment } from '../../data/types'
import type { MonthModel, PayLine } from './monthModel'
import type { Ledger } from './paymentsModel'

interface Props {
  model: MonthModel | null
  /** Month · Pay's lines. The statements use only their hours, so one can never print a rupee; the payroll summary uses all of it. */
  lines: PayLine[]
  /** null when the payments read failed. Only the payroll summary uses these three. */
  payments: Payment[] | null
  ledger: Ledger | null
  checkDates: Record<string, string[]>
  now: Date
  onNotice: (msg: string) => void
}

const ICON = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const ICONS = {
  report: <svg {...ICON}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  people: <svg {...ICON}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /></svg>,
  payroll: <svg {...ICON}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
}

const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

function Item({ icon, title, sub, tag, tone = 'neutral', onClick, disabled }: { icon?: ReactNode; title: string; sub: string; tag?: string; tone?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className="dl__item" onClick={onClick} disabled={disabled}>
      <span className="dl__icon">{icon}</span>
      <span>
        <span className="dl__title">{title}</span>
        <span className="dl__sub">{sub}</span>
      </span>
      {tag ? <span className={`tc-stamp tc-stamp--${tone}`}>{tag}</span> : <span />}
    </button>
  )
}

/**
 * Month's one Download button. PDFs are drawn on the device (offline too). The attendance report and the statements
 * hold hours only, so they are safe to print and pin up; the payroll summary carries pay, is stamped for the owner, and is the only one that does.
 */
export function DownloadMenu({ model, lines, payments, ledger, checkDates, now, onNotice }: Props) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'main' | 'people'>('main')
  const [busy, setBusy] = useState<string | null>(null)
  const share = canShareFiles()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const close = () => {
    setOpen(false)
    setView('main')
  }

  async function make(key: string, doc: TDocumentDefinitions, filename: string, mode: 'save' | 'share') {
    setBusy(key)
    try {
      const blob = await renderPdf(doc)
      if (mode === 'share') {
        const how = await shareOrSave(blob, filename, filename.replace(/\.pdf$/, '').replace(/-/g, ' '))
        if (how === 'saved') onNotice(`Saved ${filename}`)
      } else {
        saveFile(blob, filename)
        onNotice(`Saved ${filename}`)
      }
      close()
    } catch (err) {
      onNotice(`Failed: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const people = model?.people ?? []
  const statements = () => (model ? people.map((p) => buildStatement(model, p, lines.find((l) => l.emp.id === p.emp.id) as PayLine, now)) : [])
  const payroll = (m: MonthModel) =>
    buildPayrollSummary({
      monthLabel: new Date(`${m.ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      daysInMonth: m.daysInMonth, standardDayHours: STANDARD_DAY_HOURS, people: m.people, lines, payments, ledger, checkDates, now,
    })
  const sub = (key: string, text: string) => (busy === key ? 'Preparing…' : text)

  return (
    <div className="dl" ref={ref}>
      <button type="button" className="tc-btn tc-btn--primary" aria-expanded={open} aria-haspopup="menu" disabled={!model} onClick={() => (open ? close() : setOpen(true))}>
        Download ▾
      </button>
      {open && (
        <>
          <div className="dl__backdrop" onClick={close} />
          <div className="dl__panel" role="menu" aria-label={`Download ${model?.ym ?? ''}`}>
            {view === 'main' ? (
              <>
                <Item icon={ICONS.report} title="Attendance report" sub={sub('report', 'Everyone, the whole month · PDF')} tag="Shareable" tone="in" disabled={!!busy}
                  onClick={() => model && make('report', attendanceDoc(buildAttendanceReport(model, now)), `Attendance-${model.ym}.pdf`, 'share')} />
                <Item icon={ICONS.people} title="Employee statements" sub="One page each: attendance and hours, no money · PDF" tag={`${people.length} ${people.length === 1 ? 'person' : 'people'}`} disabled={!!busy}
                  onClick={() => setView('people')} />
                <Item icon={ICONS.payroll} title="Payroll summary" sub={sub('payroll', 'Salary, pay, paid out, balance · PDF')} tag="Owner only" tone="alert" disabled={!!busy}
                  onClick={() => model && make('payroll', payrollDoc(payroll(model)), `Payroll-${model.ym}.pdf`, 'save')} />
              </>
            ) : (
              <>
                <button type="button" className="tc-btn tc-btn--quiet dl__back" onClick={() => setView('main')}>‹ Employee statements</button>
                <Item title={`All ${people.length} in one PDF`} sub={sub('all', 'One page each, safe to print and pin up')} tag="Download" disabled={!!busy}
                  onClick={() => model && make('all', statementsDoc(statements()), `Statements-${model.ym}.pdf`, 'save')} />
                {people.map((p, i) => (
                  <Item key={p.emp.id} title={p.emp.name} sub={sub(p.emp.id, share ? '1 page · share on WhatsApp or save' : '1 page · PDF')} tag={share ? 'Share' : 'Save'} tone="owner" disabled={!!busy}
                    onClick={() => model && make(p.emp.id, statementsDoc([statements()[i]]), `Statement-${model.ym}-${safe(p.emp.name)}.pdf`, 'share')} />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
