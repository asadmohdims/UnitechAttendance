/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** 'false' points v2 at the real Supabase project (see `npm run dev:live`). */
  readonly VITE_DEMO_MODE?: string
  /** 'true' makes every store write refuse. `dev:live` sets it. */
  readonly VITE_READ_ONLY?: string
  readonly VITE_APP_VERSION?: string
  /** The folder v2 is served from, e.g. /UnitechAttendance/v2/. Read by vite.config.ts at build time. */
}
