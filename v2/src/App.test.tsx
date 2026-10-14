import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminUnlock } from './admin/AdminUnlock'

beforeEach(() => localStorage.clear())

describe('AdminUnlock', () => {
  it('shows the live app\'s wording when the password is wrong, and stays open', async () => {
    const onUnlocked = vi.fn()
    render(<AdminUnlock onUnlocked={onUnlocked} onCancel={() => {}} verify={async () => ({ ok: false, message: 'Wrong password' })} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unlock' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password')
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('unlocks on the right password', async () => {
    const onUnlocked = vi.fn()
    render(<AdminUnlock onUnlocked={onUnlocked} onCancel={() => {}} verify={async () => ({ ok: true })} />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unlock' })) })
    expect(onUnlocked).toHaveBeenCalled()
  })

  it('does nothing with an empty password', () => {
    render(<AdminUnlock onUnlocked={() => {}} onCancel={() => {}} verify={async () => ({ ok: true })} />)
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  })
})
