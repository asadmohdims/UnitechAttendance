import { useState } from 'react'
import { AdminShell } from './admin/AdminShell'
import { AdminUnlock } from './admin/AdminUnlock'
import { adminNeedsPassword } from './admin/auth'
import { DaysScreen } from './admin/days/DaysScreen'
import { useRoute } from './admin/route'
import { Kiosk } from './kiosk/Kiosk'
import { SheetsProvider } from './ui/Sheets'
import { NOT_BUILT, useToast } from './ui/useToast'

export function App() {
  const [route, go] = useRoute()
  // In memory only, like the live app: a reload locks admin again.
  const [unlocked, setUnlocked] = useState(!adminNeedsPassword)
  const [asking, setAsking] = useState(false)
  const [notify, toast] = useToast()

  const openAdmin = () => (unlocked ? go({ view: 'admin', tab: 'days' }) : setAsking(true))

  if (route.view === 'admin' && !unlocked) {
    // A direct link to an admin tab on a locked tablet asks for the password first.
    return (
      <>
        <Kiosk onAdminAccess={openAdmin} />
        <AdminUnlock onUnlocked={() => setUnlocked(true)} onCancel={() => go({ view: 'kiosk' })} />
      </>
    )
  }

  if (route.view === 'admin') {
    return (
      <>
        <SheetsProvider>
        <AdminShell tab={route.tab} onTab={(tab) => go({ view: 'admin', tab })} onKiosk={() => go({ view: 'kiosk' })}>
          {route.tab === 'days' ? (
            <DaysScreen onNotice={notify} initialDate={route.date} />
          ) : (
            <p className="body app-muted">{NOT_BUILT(route.tab === 'month' ? 'Month' : 'People')}</p>
          )}
        </AdminShell>
        </SheetsProvider>
        {toast}
      </>
    )
  }

  return (
    <>
      <Kiosk onAdminAccess={openAdmin} />
      {asking && (
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
