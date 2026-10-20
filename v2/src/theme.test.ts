import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, readTheme, setTheme, THEME_KEY } from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
})

describe('theme', () => {
  it('is light until someone chooses dark', () => {
    expect(readTheme()).toBe('light')
  })

  it('treats anything but "dark" as light, so a bad saved value cannot break the screens', () => {
    localStorage.setItem(THEME_KEY, 'purple')
    expect(readTheme()).toBe('light')
  })

  it('puts the choice on <html>, remembers it, and sets the browser bar colour', () => {
    setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(readTheme()).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0b0c0e')
    setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f3f5f9')
  })

  it('keeps working when storage is blocked: it applies for this visit and reads back as light', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('blocked') }
    try {
      expect(() => setTheme('dark')).not.toThrow()
      expect(document.documentElement.dataset.theme).toBe('dark')
    } finally {
      Storage.prototype.setItem = real
    }
  })

  it('applyTheme alone does not save anything', () => {
    applyTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })
})
