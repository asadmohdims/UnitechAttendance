import { usePhotoUrl } from '../../data/usePhotoUrl'
import { fmtTime } from '../../format'
import type { SlotType } from '../types'

interface Props {
  type: SlotType
  path: string | null
  side: 'in' | 'out'
  clockOut: string | null
  onOpen: (url: string) => void
}

/** Every empty photo slot says why it is empty, so "no photo" is never a mystery. */
export function PhotoSlot({ type, path, side, clockOut, onOpen }: Props) {
  const url = usePhotoUrl(type === 'photo' ? path : null)
  const label = side === 'in' ? 'Clock-in photo' : 'Clock-out photo'
  if (type === 'photo') {
    return url ? (
      <button type="button" className="tc-photo tc-photo--photo tc-photo--lg photo-btn" aria-label={`Open ${label.toLowerCase()}`} onClick={() => onOpen(url)}>
        <img src={url} alt={label} />
      </button>
    ) : (
      <div className="tc-photo tc-photo--missing tc-photo--lg" aria-label={`${label} loading`} />
    )
  }
  const text = {
    uploading: 'Uploading…',
    'not-yet': 'Not yet',
    auto: `Closed automatically ${clockOut ? fmtTime(clockOut) : ''}`.trim(),
    owner: 'Entered by you',
    missing: 'No photo',
  }[type]
  const cls = {
    uploading: 'tc-photo--uploading',
    'not-yet': 'tc-photo--not-yet',
    auto: 'tc-photo--auto',
    owner: 'tc-photo--owner',
    missing: 'tc-photo--missing',
  }[type]
  return <div className={`tc-photo ${cls} tc-photo--lg`}>{text}</div>
}
