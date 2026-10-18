import { useState } from 'react'
import { fmtTime, initials } from '../format'
import { usePhotoUrl } from '../data/usePhotoUrl'
import type { Employee, RecordRow } from '../data/types'

interface Props {
  emp: Employee
  open: RecordRow | undefined
  onTap: (emp: Employee, photoUrl: string | null) => void
  /** Payments mode: the same grid, but no clock state; every tile reads "Tap to log a payment". */
  paymentsMode?: boolean
}

// Kiosk · home board: photo (80px, a deliberate step down from the 96px large avatar so seven
// tiles fit in three rows on an 820px tablet), name, and a state band at the bottom.
export function EmployeeTile({ emp, open: openSession, onTap, paymentsMode }: Props) {
  const open = paymentsMode ? undefined : openSession
  const photoUrl = usePhotoUrl(emp.avatar)
  // A photo that will not load (a bundled demo path, a corrupt save) falls back to initials.
  const [broken, setBroken] = useState<string | null>(null)
  const showPhoto = photoUrl !== null && broken !== photoUrl
  return (
    <button type="button" className={`tc-tile${open ? ' tc-tile--in' : ''} kiosk-tile`} onClick={() => onTap(emp, photoUrl)}>
      <span className="tc-avatar tc-avatar--lg kiosk-tile__avatar">
        {showPhoto ? <img src={photoUrl!} alt="" onError={() => setBroken(photoUrl)} /> : <span aria-hidden="true">{initials(emp.name)}</span>}
      </span>
      <span className="tc-tile__name">{emp.name}</span>
      {open ? (
        <span className="tc-tile__state kiosk-tile__state">
          Working since <b>{fmtTime(open.clock_in)}</b>
          <br />
          <span style={{ fontSize: 14 }}>Tap to clock out</span>
        </span>
      ) : (
        <span className="tc-tile__state kiosk-tile__state kiosk-tile__state--out">{paymentsMode ? 'Tap to log a payment' : 'Tap to clock in'}</span>
      )}
    </button>
  )
}
