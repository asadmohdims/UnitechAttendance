import { useEffect, useRef, useState } from 'react'
import { setTheme, useTheme, type Theme } from '../theme'

const ICON = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const SUN = <svg {...ICON}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
const MOON = <svg {...ICON}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>

interface Props {
  /** "rail": a labelled item in the left rail. "header": an icon beside Kiosk on a phone. */
  variant: 'rail' | 'header'
}

/**
 * Light or dark for this device. A small pop-up with a sun and a moon: tap one and the screen changes at once,
 * the chosen one is outlined. It closes on a tap outside, on Escape, or when Display is tapped again.
 */
export function DisplayMenu({ variant }: Props) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choice = (value: Theme, label: string, icon: React.ReactNode) => (
    <button type="button" className="display-menu__choice" aria-label={label} aria-pressed={theme === value} onClick={() => setTheme(value)}>
      {icon}
    </button>
  )

  return (
    <div className={`display-menu display-menu--${variant}`} ref={root}>
      {variant === 'rail' ? (
        <button type="button" className="tc-nav-item" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {theme === 'dark' ? MOON : SUN}
          <span>Display</span>
        </button>
      ) : (
        <button type="button" className="tc-btn tc-btn--quiet display-menu__icon" aria-label="Display" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {theme === 'dark' ? MOON : SUN}
        </button>
      )}
      {open && (
        <div className="display-menu__pop" role="group" aria-label="Display">
          {choice('light', 'Light', SUN)}
          {choice('dark', 'Dark', MOON)}
        </div>
      )}
    </div>
  )
}
