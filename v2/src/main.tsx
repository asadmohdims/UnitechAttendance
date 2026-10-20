import './bridge/supabase-global' // must stay first: provides the `supabase` global the legacy store reads
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/components.css'
import './styles/base.css'
import './admin/admin.css'
import './admin/month/month.css'
import './admin/people/people.css'
import { onSignInRestored } from '@legacy/supabaseClient.js'
import { requestRefresh } from './data/invalidate'
import { App } from './App'
import { startServiceWorker } from './pwa'
import { applyTheme, readTheme } from './theme'

// After a sign-in renewal that followed refused requests, the screens may be showing saved data only.
// The store re-sends queued punches by itself; this re-reads what is on screen.
onSignInRestored(requestRefresh)

applyTheme(readTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

startServiceWorker()
