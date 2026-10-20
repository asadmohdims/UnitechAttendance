import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

/** Per device, kept in the browser. The kiosk used to read this same key, so a tablet already set to dark stays dark. */
export const THEME_KEY = 'tc2:theme'

/** The browser bar / status bar colour for each theme: the page background, so the app has no coloured strip above it. */
const BAR_COLOUR: Record<Theme, string> = { light: '#f3f5f9', dark: '#0b0c0e' }

const listeners = new Set<() => void>()

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light' // storage blocked (private window): the app still works, it just forgets the choice
  }
}

/** Puts the theme on <html>, so dialogs and everything else drawn outside the screens follow it too. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = BAR_COLOUR[theme]
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* kept for this visit only */
  }
  applyTheme(theme)
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  // Another tab on the same device changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) {
      applyTheme(readTheme())
      onChange()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'light')
}
