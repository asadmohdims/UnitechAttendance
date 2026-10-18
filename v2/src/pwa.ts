import { registerSW } from 'virtual:pwa-register'
import { isIdle } from './idle'

const CHECK_EVERY_MS = 5 * 60 * 1000
const RETRY_MS = 5000

/**
 * Offline start-up plus silent updates. The worker downloads the whole app on first run. After that it asks
 * for a new version every 5 minutes and, once one is ready, switches to it only when the kiosk is idle: a shared
 * tablet has nobody to tap "update", and a reload mid-punch would throw away the camera.
 */
export function startServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const applyWhenIdle = () => (isIdle() ? void updateSW(true) : void setTimeout(applyWhenIdle, RETRY_MS))
      applyWhenIdle()
    },
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), CHECK_EVERY_MS)
    },
  })
}
