import { afterEach, describe, expect, it } from 'vitest'
import { isIdle } from './idle'

describe('isIdle: when a new version may replace the one on screen', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('is idle on a quiet kiosk', () => {
    document.body.innerHTML = '<div class="kiosk-grid"></div>'
    expect(isIdle()).toBe(true)
  })

  it('is not idle while a camera or payment dialog is open', () => {
    document.body.innerHTML = '<dialog open></dialog>'
    expect(isIdle()).toBe(false)
  })

  it('ignores a dialog that exists but is closed', () => {
    document.body.innerHTML = '<dialog></dialog>'
    expect(isIdle()).toBe(true)
  })

  it('is not idle while a punch confirmation or the photo viewer is showing', () => {
    document.body.innerHTML = '<div class="kiosk-confirm"></div>'
    expect(isIdle()).toBe(false)
    document.body.innerHTML = '<div class="photo-viewer"></div>'
    expect(isIdle()).toBe(false)
  })
})
