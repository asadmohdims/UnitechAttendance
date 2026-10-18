import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { memoryBlobStore, resolvePhotoBlob, type PhotoDeps } from './photoCache'
import { usePhotoUrl } from './usePhotoUrl'

const jpeg = (tag: string) => new Blob([tag], { type: 'image/jpeg' })

function deps(over: Partial<PhotoDeps> = {}): PhotoDeps {
  return {
    blobs: memoryBlobStore(),
    getPhotoUrl: vi.fn(async () => 'https://signed.example/p.jpg'),
    fetchBytes: vi.fn(async () => jpeg('bytes')),
    ...over,
  }
}

describe('resolvePhotoBlob', () => {
  it('serves a saved photo with no network at all', async () => {
    const d = deps({ getPhotoUrl: vi.fn(async () => Promise.reject(new Error('offline'))) })
    const saved = jpeg('saved')
    await d.blobs.put('emp1/avatar-1.jpg', saved)
    expect(await resolvePhotoBlob('emp1/avatar-1.jpg', d)).toBe(saved)
    expect(d.getPhotoUrl).not.toHaveBeenCalled()
  })

  it('downloads once, then serves from the device', async () => {
    const d = deps()
    await resolvePhotoBlob('emp1/avatar-1.jpg', d)
    await resolvePhotoBlob('emp1/avatar-1.jpg', d)
    expect(d.getPhotoUrl).toHaveBeenCalledTimes(1)
    expect(d.fetchBytes).toHaveBeenCalledTimes(1)
  })

  it('returns null (keep initials) when offline and not yet saved', async () => {
    const d = deps({ getPhotoUrl: vi.fn(async () => null) })
    expect(await resolvePhotoBlob('emp9/avatar-1.jpg', d)).toBeNull()
  })

  it('returns null when the download fails, and saves nothing', async () => {
    const d = deps({ fetchBytes: vi.fn(async () => Promise.reject(new Error('net'))) })
    expect(await resolvePhotoBlob('emp1/avatar-1.jpg', d)).toBeNull()
    expect(await d.blobs.get('emp1/avatar-1.jpg')).toBeUndefined()
  })

  it('leaves bundled assets to the <img> itself', async () => {
    expect(await resolvePhotoBlob('assets/demo/a.jpg', deps())).toBeNull()
  })
})

describe('usePhotoUrl', () => {
  function Photo({ path, d }: { path: string; d: PhotoDeps }) {
    const url = usePhotoUrl(path, d)
    return <span data-testid="url">{url ?? 'none'}</span>
  }

  it('never shows the previous person\'s photo while the next one loads', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const d = deps({
      getPhotoUrl: vi.fn(async (p: string) => {
        if (p === 'b.jpg') await gate
        return `https://signed.example/${p}`
      }),
    })
    const { rerender } = render(<Photo path="a.jpg" d={d} />)
    await act(async () => {})
    expect(screen.getByTestId('url').textContent).toMatch('blob:')
    rerender(<Photo path="b.jpg" d={d} />)
    await act(async () => {})
    expect(screen.getByTestId('url').textContent).toBe('none')
    await act(async () => release())
    expect(screen.getByTestId('url').textContent).toMatch('blob:')
  })
})
