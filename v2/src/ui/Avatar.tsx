import { useState } from 'react'
import { usePhotoUrl } from '../data/usePhotoUrl'
import type { Employee } from '../data/types'
import { initials } from '../format'

/** The person's photo in a tile, or their initials when there is none (or it fails to load). */
export function Avatar({ emp, large }: { emp: Employee; large?: boolean }) {
  const url = usePhotoUrl(emp.avatar)
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <span className={`tc-avatar${large ? ' tc-avatar--lg' : ''}`} style={{ overflow: 'hidden', padding: 0 }}>
      {url && broken !== url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setBroken(url)} /> : <span aria-hidden="true">{initials(emp.name)}</span>}
    </span>
  )
}
