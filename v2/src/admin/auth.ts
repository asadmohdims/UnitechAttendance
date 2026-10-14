import { DEMO_MODE } from '@legacy/config.js'
import { persistedSession, sb, TIMEOUT_MESSAGE, withTimeout } from '@legacy/supabaseClient.js'

export const adminNeedsPassword = !DEMO_MODE

export type UnlockResult = { ok: true } | { ok: false; message: string }

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
    if (error.message === TIMEOUT_MESSAGE || error.status === 0 || error.name === 'AuthRetryableFetchError') {
      return { ok: false, message: 'Can’t reach the server — unlocking needs internet. Check the Wi-Fi and try again.' }
    }
    return { ok: false, message: error.message }
  } catch {
    return { ok: false, message: 'Can’t reach the server — unlocking needs internet. Check the Wi-Fi and try again.' }
  }
}
