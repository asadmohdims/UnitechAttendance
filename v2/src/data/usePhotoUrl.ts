import { useEffect, useState } from 'react'
import { defaultPhotoDeps, resolvePhotoBlob, type PhotoDeps } from './photoCache'

/** An object URL for the employee's photo, or null while loading / unavailable (show initials). */
export function usePhotoUrl(path: string | null | undefined, deps: PhotoDeps = defaultPhotoDeps): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setUrl(null)
      return
    }
    if (path.startsWith('assets/')) {
      setUrl(path)
      return
    }
    let cancelled = false
    let made: string | null = null
    setUrl(null) // never show the previous person's photo while this one loads
    void resolvePhotoBlob(path, deps).then((blob) => {
      if (cancelled || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [path, deps])

  return url
}
