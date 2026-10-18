import '../bridge/supabase-global'
import '@testing-library/jest-dom/vitest'

// Node 25 ships an experimental global `localStorage` that is unusable without
// --localstorage-file and shadows jsdom's. The demo store keeps everything in localStorage,
// so give tests a plain in-memory Storage instead of depending on either.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true })
  // A test file that runs in plain node (the PDF tests) has no window to mirror it onto.
  if (typeof window !== 'undefined') Object.defineProperty(window, name, { value: (globalThis as unknown as Record<string, Storage>)[name], configurable: true, writable: true })
}

// jsdom has no object URLs; photos are shown through them.
let objectUrlCounter = 0
URL.createObjectURL = () => `blob:test/${++objectUrlCounter}`
URL.revokeObjectURL = () => {}
