import { useEffect, useState } from 'react'
import { AdminShell } from './admin/AdminShell'
import { AdminUnlock } from './admin/AdminUnlock'
import { adminNeedsPassword, needsSignIn, signOutDevice } from './admin/auth'
import { DaysScreen } from './admin/days/DaysScreen'
import { MonthScreen } from './admin/month/MonthScreen'
import { PeopleScreen } from './admin/people/PeopleScreen'
import { useRoute } from './admin/route'
import { SignIn } from './admin/SignIn'
import { Kiosk } from './kiosk/Kiosk'
import { applyZoomLock } from './kiosk/zoomLock'
import { READ_ONLY } from './data/store'
import { SheetsProvider } from './ui/Sheets'
import { useToast } from './ui/useToast'

/** Shown only by `npm run dev:live`: this is the real database and every write is refused. */
const ReadOnlyBadge = () => READ_ONLY ? <div className="tc-stamp tc-stamp--attention" style={{ position: 'fixed', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 60, pointerEvents: 'none', whiteSpace: 'nowrap' }}>Live data · read-only</div> : null

export function App() {
  return (
    <>
      <ReadOnlyBadge />
      <AppBody />
    </>
  )
}

function AppBody() {
  const [route, go] = useRoute()
  // In memory only, like the live app: a reload locks admin again.
  const [unlocked, setUnlocked] = useState(!adminNeedsPassword)
  const [asking, setAsking] = useState(false)
  const [signedIn, setSignedIn] = useState(!needsSignIn())
  // Bumped after a sign-in so the kiosk behind it reads real data instead of what it had while signed out.
  const [session, setSession] = useState(0)
  const [notify, toast] = useToast()
  useEffect(() => applyZoomLock(route.view === 'kiosk'), [route.view])

  const openAdmin = () => (unlocked ? go({ view: 'admin', tab: 'days' }) : setAsking(true))

  const lock = () => {
    if (adminNeedsPassword) setUnlocked(false)
    go({ view: 'kiosk' })
  }
  const signOut = async () => {
    if (!adminNeedsPassword) {
      // Demo mode has no account to sign out of.
      go({ view: 'kiosk' })
      notify('Demo mode: no sign-in is required.')
      return
    }
    await signOutDevice()
    window.location.reload()
  }

  const signInGate = !signedIn && <SignIn onSignedIn={() => { setSignedIn(true); setSession((n) => n + 1) }} />

  if (route.view === 'admin' && !unlocked) {
    // A direct link to an admin tab on a locked tablet asks for the password first.
    return (
      <>
        <Kiosk key={session} onAdminAccess={openAdmin} />
        {signInGate || <AdminUnlock onUnlocked={() => setUnlocked(true)} onCancel={() => go({ view: 'kiosk' })} />}
      </>
    )
  }

  if (route.view === 'admin') {
    return (
      <>
        <SheetsProvider>
        <AdminShell tab={route.tab} onTab={(tab) => go({ view: 'admin', tab })} onKiosk={() => go({ view: 'kiosk' })}>
          {route.tab === 'days' ? (
            <DaysScreen onNotice={notify} initialDate={route.date} initialEmp={route.emp} />
          ) : route.tab === 'month' ? (
            <MonthScreen onNotice={notify} onOpenDay={(date, emp) => go({ view: 'admin', tab: 'days', date, emp })} />
          ) : (
            <PeopleScreen onNotice={notify} onLock={lock} onSignOut={() => void signOut()} />
          )}
        </AdminShell>
        </SheetsProvider>
        {toast}
        {signInGate}
      </>
    )
  }

  return (
    <>
      <Kiosk key={session} onAdminAccess={openAdmin} />
      {signInGate}
      {signedIn && asking && (
        <AdminUnlock
          onUnlocked={() => {
            setUnlocked(true)
            setAsking(false)
            go({ view: 'admin', tab: 'days' })
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
