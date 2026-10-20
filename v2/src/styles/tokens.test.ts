import { describe, expect, it } from 'vitest'
import tokens from './tokens.json'

type Theme = 'light' | 'dark'
const colour = (theme: Theme) =>
  Object.fromEntries((tokens.color.tokens as { name: string; value: Record<Theme, string> }[]).map((t) => [t.name, t.value[theme]])) as Record<string, string>

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// tokens.json is the source the theme CSS is written from. A theme that fails any of these is not shipped.
describe.each(['light', 'dark'] as Theme[])('%s theme contrast', (theme) => {
  const t = colour(theme)
  it('keeps body and muted text readable on the page, cards and wells (4.5:1)', () => {
    for (const ground of ['bg', 'surface', 'sunken']) {
      expect(ratio(t.ink, t[ground]), `ink on ${ground}`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(t['ink-muted'], t[ground]), `ink-muted on ${ground}`).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('keeps control borders visible on cards (3:1)', () => {
    expect(ratio(t['line-strong'], t.surface)).toBeGreaterThanOrEqual(3)
  })
  it('keeps each status colour readable on its own tint (4.5:1)', () => {
    for (const s of ['in', 'attention', 'alert', 'holiday', 'brand']) {
      expect(ratio(t[`${s}-ink`], t[`${s}-tint`]), s).toBeGreaterThanOrEqual(4.5)
    }
  })
})
