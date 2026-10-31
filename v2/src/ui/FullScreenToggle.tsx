import { useEffect, useState } from 'react'

const ICON = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const EXPAND = <svg {...ICON}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
const SHRINK = <svg {...ICON}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>

/** True while the page is full screen, however it got there or out (this button, or Android's edge swipe). */
function useFullScreen(): boolean {
  const [on, setOn] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  return on
}

/**
 * Full screen for the kiosk tablet, in the admin rail only so a tap on a tile can never leave it. A browser only
 * starts full screen from a tap, so it cannot be restored by itself after a restart: the owner taps this once.
 * The label says how to leave while it is on ("Exit full screen"), and it follows the system's own exit too.
 * Hidden where the browser has no full-screen support (an iPad, for one).
 */
export function FullScreenToggle() {
  const on = useFullScreen()
  if (!document.fullscreenEnabled) return null

  const toggle = () => {
    // A refusal (no tap, or the browser said no) leaves the screen as it is; the button then still shows the truth.
    const done = on ? document.exitFullscreen() : document.documentElement.requestFullscreen()
    done.catch(() => {})
  }

  return (
    <button type="button" className="tc-nav-item fullscreen-toggle" aria-pressed={on} onClick={toggle}>
      {on ? SHRINK : EXPAND}
      <span>{on ? 'Exit full screen' : 'Full screen'}</span>
    </button>
  )
}
