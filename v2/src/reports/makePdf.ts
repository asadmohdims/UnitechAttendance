import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import figtreeRegular from '../assets/pdf-fonts/Figtree_400Regular.ttf?url'
import figtreeBold from '../assets/pdf-fonts/Figtree_600SemiBold.ttf?url'
import plexRegular from '../assets/pdf-fonts/IBMPlexMono_400Regular.ttf?url'
import plexBold from '../assets/pdf-fonts/IBMPlexMono_600SemiBold.ttf?url'
import { PDF_FONTS } from './fonts'

/**
 * Builds a PDF on this device. The library (about 330 KB gzipped) and the four small font files load the first time a
 * report is asked for, not with the app, and the service worker keeps them, so reports also work with no network.
 */
interface Engine {
  addVirtualFileSystem: (vfs: Record<string, string>) => void
  addFonts: (fonts: Record<string, Record<string, string>>) => void
  createPdf: (doc: TDocumentDefinitions) => { getBlob: () => Promise<Blob> }
}

const FILE_URLS: Record<string, string> = {
  [PDF_FONTS.Figtree.normal]: figtreeRegular,
  [PDF_FONTS.Figtree.bold]: figtreeBold,
  [PDF_FONTS.PlexMono.normal]: plexRegular,
  [PDF_FONTS.PlexMono.bold]: plexBold,
}

async function toBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`font file ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

let engine: Promise<Engine> | null = null

function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const [mod, files] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      Promise.all(Object.entries(FILE_URLS).map(async ([name, url]) => [name, await toBase64(url)] as const)),
    ])
    const pdfMake = ((mod as { default?: Engine }).default ?? mod) as unknown as Engine
    pdfMake.addVirtualFileSystem(Object.fromEntries(files))
    pdfMake.addFonts({ Figtree: { ...PDF_FONTS.Figtree }, PlexMono: { ...PDF_FONTS.PlexMono } })
    return pdfMake
  })().catch((err) => {
    engine = null // a failed first load (no network yet) must be retried next time, not remembered
    throw err
  })
  return engine
}

export async function renderPdf(doc: TDocumentDefinitions): Promise<Blob> {
  return (await loadEngine()).createPdf(doc).getBlob()
}
