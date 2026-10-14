import { useEffect, useRef, useState } from 'react'
import { captureSize, isUsablePhoto } from '@legacy/captureGuard.js'

export type CapturePhoto = (video: HTMLVideoElement) => Promise<Blob | null>

/** Draws the current frame to a small JPEG. Returns null when there is no frame yet. */
export const captureFrame: CapturePhoto = async (video) => {
  const size = captureSize(video.videoWidth, video.videoHeight)
  if (!size) return null
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  canvas.getContext('2d')?.drawImage(video, 0, 0, size.width, size.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7))
}

interface Props {
  name: string
  action: 'in' | 'out'
  /** Does the store work for the photo. A throw keeps the dialog open with the error shown. */
  onCapture: (photo: Blob) => Promise<void>
  onCancel: () => void
  /** Injected in tests; the browser's own by default. */
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>
  capture?: CapturePhoto
}

// Wording and states come from the Kiosk · punch flow board, panel 1.
const MSG = {
  starting: 'Starting the camera…',
  failed: "Photo didn't come out. Tap Take photo again.",
  denied: 'Camera unavailable: permission was denied.',
}

export function CameraDialog({ name, action, onCapture, onCancel, mediaDevices, capture = captureFrame }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Set synchronously on the shutter tap: a second tap in the same tick must not start a second
  // punch (one photo once recorded an in and an immediate out).
  const shutterBusy = useRef(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState(MSG.starting)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(0)
  const [cameraBroken, setCameraBroken] = useState(false)

  useEffect(() => {
    const el = dialogRef.current
    if (el && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    const devices = mediaDevices ?? navigator.mediaDevices
    devices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
        // The shutter stays off until the first frame decodes (onLoadedData below).
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCameraBroken(true)
        const e = err as { name?: string; message?: string }
        setMessage(e?.name === 'NotAllowedError' ? MSG.denied : `Camera unavailable: ${e?.message ?? 'unknown error'}`)
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      // Stopping the tracks alone is not enough on Chrome for Android: the <video> keeps the
      // capture (and the screen awake) until its srcObject is cleared.
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [mediaDevices])

  async function takePhoto() {
    if (shutterBusy.current || !ready) return
    shutterBusy.current = true
    setSaving(true)
    setFlash((n) => n + 1)
    try {
      const video = videoRef.current
      // No photo, no punch: refuse before anything is written, so the retry is a clean first attempt.
      const photo = video ? await capture(video) : null
      if (!isUsablePhoto(photo)) {
        setMessage(MSG.failed)
        return
      }
      setMessage('')
      await onCapture(photo as Blob)
    } catch (err) {
      setMessage(`Failed: ${(err as Error).message} — try again.`)
    } finally {
      shutterBusy.current = false
      setSaving(false)
    }
  }

  const shutterDisabled = !ready || saving || cameraBroken

  return (
    <dialog ref={dialogRef} className="kiosk-camera" aria-labelledby="camera-title" onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <div className="kiosk-camera__card">
        <div>
          <h2 id="camera-title" className="title-2">{action === 'in' ? `Clock in, ${name}?` : `Clock out, ${name}?`}</h2>
          <p className="body kiosk-muted">Look at the camera, then take your photo.</p>
        </div>
        <div className="kiosk-camera__view">
          <video ref={videoRef} autoPlay playsInline muted onLoadedData={() => { setReady(true); setMessage('') }} />
          {flash > 0 && <span key={flash} className="kiosk-camera__flash" aria-hidden="true" />}
        </div>
        <div className="caption kiosk-camera__msg" role="status">{message}</div>
        <div className="kiosk-camera__actions">
          <button type="button" className="tc-btn tc-btn--primary tc-btn--kiosk" disabled={shutterDisabled} onClick={takePhoto}>Take photo</button>
          <button type="button" className="tc-btn tc-btn--secondary tc-btn--kiosk" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </dialog>
  )
}
