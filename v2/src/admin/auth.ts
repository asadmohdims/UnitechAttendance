import { DEMO_MODE } from '@legacy/config.js'
import { hasPersistedSession, persistedSession, sb, TIMEOUT_MESSAGE, withTimeout } from '@legacy/supabaseClient.js'

export const adminNeedsPassword = !DEMO_MODE

export type UnlockResult = { ok: true } | { ok: false; message: string }

/** True when this tablet has no saved sign-in at all. Demo mode never needs one. */
export const needsSignIn = () => !DEMO_MODE && !hasPersistedSession()

// Anything that means "the server could not be reached", as opposed to a real "no".
const isNetworkFailure = (error: { message?: string; status?: number; name?: string }) =>
  error.message === TIMEOUT_MESSAGE || error.status === 0 || error.name === 'AuthRetryableFetchError'

const OFFLINE = (what: string) => `Can’t reach the server — ${what} needs internet. Check the Wi-Fi and try again.`

/**
 * Admin unlock is a client-side gate: it re-checks the owner's password against the account the
 * tablet is already signed in with. It does not create a separate identity (that is the
 * role-based access item on the security list), so it keeps the live app's exact behaviour.
 */
export async function unlockAdmin(password: string): Promise<UnlockResult> {
  // The email is read from the saved session, not fetched: a server round trip here once crashed
  // silently offline and left the dialog stuck.
  const email: string | undefined = persistedSession()?.user?.email
  if (!email) return { ok: false, message: 'This tablet’s sign-in is missing — sign out and sign in again.' }
  try {
    const { error } = await withTimeout(sb.auth.signInWithPassword({ email, password }))
    if (!error) return { ok: true }
    if (error.code === 'invalid_credentials' || error.status === 400) return { ok: false, message: 'Wrong password' }
    if (isNetworkFailure(error)) return { ok: false, message: OFFLINE('unlocking') }
    return { ok: false, message: error.message }
  } catch {
    return { ok: false, message: OFFLINE('unlocking') }
  }
}

/** The tablet's own sign-in: the one account the kiosk and the admin share. */
export async function signInDevice(email: string, password: string): Promise<UnlockResult> {
  try {
    const { error } = await withTimeout(sb.auth.signInWithPassword({ email, password }))
    if (!error) return { ok: true }
    if (error.code === 'invalid_credentials' || error.status === 400) return { ok: false, message: 'Wrong email or password.' }
    if (isNetworkFailure(error)) return { ok: false, message: OFFLINE('signing in') }
    return { ok: false, message: error.message }
  } catch {
    return { ok: false, message: OFFLINE('signing in') }
  }
}

/** Offline, the server-side sign-out fails and supabase-js keeps the session, so a local sign-out follows. */
export async function signOutDevice(): Promise<void> {
  let failed = false
  try {
    const { error } = await withTimeout(sb.auth.signOut())
    failed = !!error
  } catch {
    failed = true
  }
  if (failed) await sb.auth.signOut({ scope: 'local' })
}
