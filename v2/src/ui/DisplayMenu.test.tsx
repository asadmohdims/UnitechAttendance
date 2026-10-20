import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readTheme, setTheme } from '../theme'
import { DisplayMenu } from './DisplayMenu'

beforeEach(() => {
  localStorage.clear()
  setTheme('light')
})

describe('DisplayMenu', () => {
  it('opens a small pop-up with a sun and a moon, the current one marked', () => {
    render(<DisplayMenu variant="rail" />)
    expect(screen.queryByRole('group', { name: 'Display' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Display/ }))
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('changes the theme at once and stays open so the owner can flip it back', () => {
    render(<DisplayMenu variant="header" />)
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(readTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(readTheme()).toBe('light')
  })

  it('closes on Escape, on a tap outside, and when Display is tapped again', () => {
    render(<div><DisplayMenu variant="rail" /><p>elsewhere</p></div>)
    const open = () => fireEvent.click(screen.getByRole('button', { name: /Display/ }))
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Display' })).toBeNull()
    open()
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(screen.queryByRole('group', { name: 'Display' })).toBeNull()
    open()
    open()
    expect(screen.queryByRole('group', { name: 'Display' })).toBeNull()
  })
})
