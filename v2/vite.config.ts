/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [legacyConfig(), react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), '@legacy': legacyJs } },
  server: { fs: { allow: ['..'] } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
