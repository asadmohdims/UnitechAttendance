import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SignIn } from './SignIn'

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('Sign in', () => {
  it('needs both fields, then signs in with them and tells the app', async () => {
    const signIn = vi.fn(async () => ({ ok: true as const }))
    const onSignedIn = vi.fn()
    render(<SignIn onSignedIn={onSignedIn} signIn={signIn} />)
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).toBeDisabled()
    fill('Email', ' owner@unitech.example ')
    expect(button).toBeDisabled()
    fill('Password', 'hunter2')
    await act(async () => { fireEvent.click(button) })
    expect(signIn).toHaveBeenCalledWith('owner@unitech.example', 'hunter2')
    expect(onSignedIn).toHaveBeenCalledTimes(1)
  })

  it('keeps the dialog open and says why when the server cannot be reached', async () => {
    const message = 'Can’t reach the server — signing in needs internet. Check the Wi-Fi and try again.'
    const onSignedIn = vi.fn()
    render(<SignIn onSignedIn={onSignedIn} signIn={async () => ({ ok: false as const, message })} />)
    fill('Email', 'a@b.co')
    fill('Password', 'x')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })) })
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('cannot be dismissed with Escape: a tablet with no sign-in has nothing to show', () => {
    render(<SignIn onSignedIn={vi.fn()} signIn={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { hidden: true })
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
  })
})
