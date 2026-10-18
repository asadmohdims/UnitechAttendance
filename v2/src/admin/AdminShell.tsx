import type { ReactNode } from 'react'
import type { AdminTab } from './route'

const ICON = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

const ITEMS: { tab: AdminTab; label: string; icon: ReactNode }[] = [
  { tab: 'days', label: 'Days', icon: <svg {...ICON}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg> },
  { tab: 'month', label: 'Month', icon: <svg {...ICON}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg> },
  { tab: 'people', label: 'People', icon: <svg {...ICON}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.3 3.5 5.2" /></svg> },
]
const KIOSK_ICON = <svg {...ICON}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M10 18h4" /></svg>

interface Props {
  tab: AdminTab
  onTab: (t: AdminTab) => void
  onKiosk: () => void
  children: ReactNode
}

/** Left rail from 900px, bottom tab bar below (the Kiosk exit moves to the page header there). */
export function AdminShell({ tab, onTab, onKiosk, children }: Props) {
  return (
    <div className="admin">
      <nav className="tc-rail admin-rail" aria-label="Main">
        {ITEMS.map((i) => (
          <button key={i.tab} type="button" className="tc-nav-item" aria-current={i.tab === tab ? 'page' : undefined} onClick={() => onTab(i.tab)}>
            {i.icon}
            <span>{i.label}</span>
          </button>
        ))}
        <button type="button" className="tc-nav-item tc-nav-item--exit" onClick={onKiosk}>
          {KIOSK_ICON}
          <span>Kiosk</span>
        </button>
      </nav>
      <div className="admin-content">
        <div className="admin-phone-exit">
          <button type="button" className="tc-btn tc-btn--quiet" onClick={onKiosk}>Kiosk</button>
        </div>
        {children}
      </div>
      <nav className="tc-tabbar admin-tabbar" aria-label="Main">
        {ITEMS.map((i) => (
          <button key={i.tab} type="button" className="tc-nav-item" aria-current={i.tab === tab ? 'page' : undefined} onClick={() => onTab(i.tab)}>
            {i.icon}
            <span>{i.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
