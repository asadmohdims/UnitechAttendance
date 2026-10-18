import { useEffect, useRef, useState } from 'react'
import { signInDevice, type UnlockResult } from './auth'

interface Props {
  onSignedIn: () => void
  /** Injected in tests. */
  signIn?: (email: string, password: string) => Promise<UnlockResult>
}

// Wording from the Dialogs board, "Sign in". It cannot be dismissed: a tablet with no sign-in has no data to show.
export function SignIn({ onSignedIn, signIn = signInDevice }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState('')
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
    if (!email.trim() || !password || busy) return
    setBusy(true)
    setError('')
    const result = await signIn(email.trim(), password)
    setBusy(false)
    if (result.ok) onSignedIn()
    else setError(result.message)
  }

  return (
    <dialog ref={dialogRef} className="sheet-dialog" aria-labelledby="signin-title" onCancel={(e) => e.preventDefault()}>
      <form className="tc-sheet" onSubmit={submit}>
        <h2 id="signin-title" className="title-2" style={{ margin: 0 }}>Sign in</h2>
        <div className="tc-field">
          <label className="tc-field__label" htmlFor="signin-email">Email</label>
          <input id="signin-email" className="tc-field__input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="tc-field">
          <label className="tc-field__label" htmlFor="signin-password">Password</label>
          <input id="signin-password" className="tc-field__input" type="password" autoComplete="current-password" value={password} aria-invalid={error ? true : undefined} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="app-error" role="alert">{error}</div>}
        <button type="submit" className="tc-btn tc-btn--primary" style={{ width: '100%' }} disabled={!email.trim() || !password || busy}>Sign in</button>
      </form>
    </dialog>
  )
}
