import { describe, expect, it } from 'vitest'
import { applyZoomLock, viewportContent } from './zoomLock'

describe('kiosk pinch-zoom lock', () => {
  it('turns zoom off on the kiosk and back on elsewhere, keeping the safe-area setting', () => {
    expect(viewportContent(true)).toContain('user-scalable=no')
    expect(viewportContent(true)).toContain('maximum-scale=1')
    expect(viewportContent(false)).not.toContain('user-scalable')
    for (const locked of [true, false]) expect(viewportContent(locked)).toContain('viewport-fit=cover')
  })

  it('rewrites the page\'s one viewport tag', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">'
    applyZoomLock(true)
    expect(document.querySelector('meta[name=viewport]')!.getAttribute('content')).toContain('user-scalable=no')
    applyZoomLock(false)
    expect(document.querySelector('meta[name=viewport]')!.getAttribute('content')).not.toContain('user-scalable')
  })
})
