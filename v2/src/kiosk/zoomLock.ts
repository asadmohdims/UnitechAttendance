// Pinch-zoom is off only on the shared kiosk, where a stray two-finger touch mid-queue zooms the whole
// screen and nobody can undo it. Every admin screen turns it back on: the owner reviewing on a phone
// must be able to zoom in. (Browsers that ignore user-scalable, such as iOS Safari, keep zoom either way.)
const BASE = 'width=device-width, initial-scale=1, viewport-fit=cover'
export const viewportContent = (locked: boolean) => (locked ? `${BASE}, maximum-scale=1, user-scalable=no` : BASE)

export function applyZoomLock(locked: boolean, doc: Document = document): void {
  doc.querySelector('meta[name=viewport]')?.setAttribute('content', viewportContent(locked))
}
