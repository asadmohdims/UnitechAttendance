import { store } from './store'

/**
 * Employee photos kept on the device. A photo's path never changes content (a retake gets a new
 * path), so a saved copy is valid forever. Offline, the kiosk shows the real picture; the legacy
 * app shows initials because it asks the server for a one-hour signed URL on every load.
 */
export interface BlobStore {
  get(path: string): Promise<Blob | undefined>
  put(path: string, blob: Blob): Promise<void>
}

export function memoryBlobStore(): BlobStore {
  const m = new Map<string, Blob>()
  return { get: async (p) => m.get(p), put: async (p, b) => void m.set(p, b) }
}

const CACHE_NAME = 'tc2-photos-v1'
const keyFor = (path: string) => `/__photo/${encodeURI(path)}`

/** Backed by the Cache Storage API, which the service worker can also read in plan step 6. */
export function cacheStorageBlobStore(): BlobStore {
  return {
    async get(path) {
      try {
        const hit = await (await caches.open(CACHE_NAME)).match(keyFor(path))
        return hit ? await hit.blob() : undefined
      } catch {
        return undefined
      }
    },
    async put(path, blob) {
      try {
        await (await caches.open(CACHE_NAME)).put(keyFor(path), new Response(blob, { headers: { 'content-type': blob.type || 'image/jpeg' } }))
      } catch {
        /* storage full or unavailable: the photo just is not cached */
      }
    },
  }
}

export interface PhotoDeps {
  blobs: BlobStore
  getPhotoUrl: (path: string) => Promise<string | null>
  fetchBytes: (url: string) => Promise<Blob>
}

export const defaultPhotoDeps: PhotoDeps = {
  blobs: typeof caches !== 'undefined' ? cacheStorageBlobStore() : memoryBlobStore(),
  getPhotoUrl: (path) => store.getPhotoUrl(path),
  fetchBytes: async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`photo fetch ${res.status}`)
    return res.blob()
  },
}

/**
 * Saved copy first (no network); otherwise ask for a signed URL, download the bytes and keep
 * them. Resolves to a blob you can show, or null so the caller keeps its initials.
 */
export async function resolvePhotoBlob(path: string, deps: PhotoDeps = defaultPhotoDeps): Promise<Blob | null> {
  if (path.startsWith('assets/')) return null // bundled image: the <img> can use the path directly
  const saved = await deps.blobs.get(path)
  if (saved) return saved
  try {
    const url = await deps.getPhotoUrl(path)
    if (!url) return null
    const blob = await deps.fetchBytes(url)
    await deps.blobs.put(path, blob)
    return blob
  } catch {
    return null
  }
}
