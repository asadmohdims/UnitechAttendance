// Display formats from the design system's Vocabulary: 12-hour times with AM/PM, h:mm durations,
// "Tuesday, 13 October". Kept here (not imported from the legacy utils.js) because that module
// also holds DOM helpers.

export const fmtTime = (iso: string | Date): string =>
  new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/am|pm/i, (p) => p.toUpperCase())

export function fmtHours(hours: number): string {
  const m = Math.round(hours * 60)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function fmtDateLong(d: Date): string {
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' })
  const month = d.toLocaleDateString('en-GB', { month: 'long' })
  return `${weekday}, ${d.getDate()} ${month}`
}

/** "Tue 13 Oct": the short form for a phone header. */
export function fmtDateShort(d: Date): string {
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' }).replace(',', '')} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}

/** Local calendar day as YYYY-MM-DD, the shape `records.date` uses. */
export function dateKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}
