/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const legacyJs = path.resolve(__dirname, '../js')

/**
 * v2 reuses the live app's domain and store modules from ../js without editing them.
 * js/config.js hard-codes DEMO_MODE; here that one line is rewritten at build time so
 * `npm run dev` and the tests run against the local demo store by default and nothing
 * writes to the real Supabase project by accident. Set VITE_DEMO_MODE=false to use it.
 */
function legacyConfig(): Plugin {
  const target = path.join(legacyJs, 'config.js')
  return {
    name: 'legacy-config-demo-mode',
    enforce: 'pre',
    transform(code, id) {
      if (path.normalize(id.split('?')[0]) !== target) return null
      const next = code.replace(
        /export const DEMO_MODE = (true|false);/,
        "export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';",
      )
      if (next === code) throw new Error('legacy-config-demo-mode: DEMO_MODE line in js/config.js changed shape')
      return { code: next, map: null }
    },
  }
}

/**
 * The offline half of the kiosk: a service worker that downloads every file the app needs the first time
 * it runs, then serves them without the network. A dev server never gets one (it must always serve fresh files). `registerType: 'prompt' so the app, not the browser, decides when to switch to a new version:
 * src/pwa.ts waits until nobody is mid-punch. Supabase is another origin and never touched here.
 */
const pwa = () =>
  VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      name: 'Unitech Attendance 2',
      short_name: 'Unitech 2',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#1d3fd1',
      theme_color: '#1d3fd1',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2,ttf,png,svg}'],
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // the Excel exporter and the PDF library are large and must work offline too
    },
  })

// `VITE_BASE` is the folder v2 is served from: '/' in development, '/UnitechAttendance/v2/' on GitHub Pages.
export default defineConfig(() => ({
  base: process.env.VITE_BASE ?? '/',
  // The plugin is loaded in every mode so `virtual:pwa-register` resolves; in development and in tests it is a no-op
  // (no worker is generated or registered), and src/pwa.ts also returns early on `import.meta.env.DEV`.
  plugins: [legacyConfig(), react(), pwa()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@legacy': legacyJs } },
  server: { fs: { allow: ['..'] } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}))
