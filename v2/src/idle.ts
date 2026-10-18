/** Nothing is open that a reload would interrupt: no camera or payment dialog, no confirmation, no photo viewer. */
export const isIdle = (doc: Document = document): boolean => !doc.querySelector('dialog[open], .kiosk-confirm, .photo-viewer')
