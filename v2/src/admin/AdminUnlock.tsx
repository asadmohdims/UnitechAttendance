import { useEffect, useRef, useState } from 'react'
import { unlockAdmin, type UnlockResult } from './auth'

interface Props {
  onUnlocked: () => void
  onCancel: () => void
  /** Injected in tests. */
  verify?: (password: string) => Promise<UnlockResult>
}

// Wording from the Dialogs board, "Admin unlock".
export function AdminUnlock({ onUnlocked, onCancel, verify = unlockAdmin }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const el = dialogRef.current
    if (el && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    const result = await verify(password)
    setBusy(false)
    if (result.ok) onUnlocked()
    else setError(result.message)
  }

  return (
    <dialog ref={dialogRef} className="sheet-dialog" aria-labelledby="unlock-title" onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <form className="tc-sheet" onSubmit={submit}>
        <h2 id="unlock-title" className="title-2" style={{ margin: 0 }}>Admin unlock</h2>
        <p className="body app-muted" style={{ margin: 0 }}>Enter the admin password to open this section.</p>
        <div className="tc-field">
          <label className="tc-field__label" htmlFor="unlock-password">Password</label>
          <input
            id="unlock-password"
            className="tc-field__input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div className="app-error" role="alert">{error}</div>}
        <div className="tc-sheet__actions">
          <button type="submit" className="tc-btn tc-btn--primary" disabled={!password || busy}>Unlock</button>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </dialog>
  )
}
