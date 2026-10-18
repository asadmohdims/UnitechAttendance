/** Phones and tablets have a share sheet worth using; on a desktop a report should simply download. */
export const canShareFiles = (): boolean => {
  try {
    const file = new File([''], 'x.pdf', { type: 'application/pdf' })
    return !!navigator.canShare?.({ files: [file] }) && !!window.matchMedia?.('(pointer: coarse)').matches
  } catch {
    return false
  }
}

export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export type Delivery = 'shared' | 'saved' | 'cancelled'

/** Share sheet where the device has one, a download everywhere else (and when sharing fails). */
export async function shareOrSave(blob: Blob, filename: string, title: string): Promise<Delivery> {
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [new File([blob], filename, { type: 'application/pdf' })], title })
      return 'shared'
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled' // they closed the sheet: that is an answer, not a failure
    }
  }
  saveFile(blob, filename)
  return 'saved'
}
