import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FullScreenToggle } from './FullScreenToggle'

// jsdom has no full-screen support, so the page's own API is stood in for.
let element: Element | null
const request = vi.fn(() => { element = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve() })
const exit = vi.fn(() => { element = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve() })

beforeEach(() => {
  element = null
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
  document.documentElement.requestFullscreen = request
  document.exitFullscreen = exit
})
afterEach(() => vi.clearAllMocks())

describe('FullScreenToggle', () => {
  it('goes full screen on a tap, then says how to leave and leaves on the next tap', async () => {
    render(<FullScreenToggle />)
    const button = screen.getByRole('button', { name: 'Full screen' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { fireEvent.click(button) })
    expect(request).toHaveBeenCalledTimes(1)
    const leave = screen.getByRole('button', { name: 'Exit full screen' })
    expect(leave).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { fireEvent.click(leave) })
    expect(exit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
  })

  it("follows the system's own exit, such as Android's edge swipe", () => {
    element = document.documentElement
    render(<FullScreenToggle />)
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument()
    act(() => { element = null; document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
  })

  it('is not drawn where the browser has no full-screen support', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
    render(<FullScreenToggle />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
