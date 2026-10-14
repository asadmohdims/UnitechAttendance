import { useRef } from 'react'
import { dateKey } from '../../format'

const label = (date: string, today: string) => {
  const d = new Date(`${date}T12:00:00`)
  const y = new Date(`${today}T12:00:00`)
  y.setDate(y.getDate() - 1)
  const short = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const sub = date === today ? 'Today' : date === dateKey(y) ? 'Yesterday' : d.toLocaleDateString('en-IN', { year: 'numeric' })
  return `${short} · ${sub}`
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

interface Props {
  date: string
  today: string
  onChange: (date: string) => void
}

/** Previous / date / next. The date opens the browser's own date picker. Never goes past today. */
export function PeriodControl({ date, today, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="tc-period">
      <button type="button" className="tc-period__step" aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))}>‹</button>
      <button
        type="button"
        className="tc-period__label period-label"
        aria-label="Choose a date"
        onClick={() => (input.current?.showPicker ? input.current.showPicker() : input.current?.focus())}
      >
        {label(date, today)}
      </button>
      <input
        ref={input}
        className="period-input"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={date}
        max={today}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
      <button type="button" className="tc-period__step" aria-label="Next day" disabled={date >= today} onClick={() => onChange(shiftDate(date, 1))}>›</button>
    </div>
  )
}
