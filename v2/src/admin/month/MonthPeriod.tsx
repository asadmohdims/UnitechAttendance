const label = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Props {
  ym: string
  /** The current month; the control never goes past it. */
  currentYm: string
  onChange: (ym: string) => void
}

export function MonthPeriod({ ym, currentYm, onChange }: Props) {
  return (
    <div className="tc-period">
      <button type="button" className="tc-period__step" aria-label="Previous month" onClick={() => onChange(shiftMonth(ym, -1))}>‹</button>
      <span className="tc-period__label">{label(ym)}</span>
      <button type="button" className="tc-period__step" aria-label="Next month" disabled={ym >= currentYm} onClick={() => onChange(shiftMonth(ym, 1))}>›</button>
    </div>
  )
}
