import { render, screen } from '@testing-library/react'
import { App } from './App'

// Proves the whole bridge: npm supabase-js -> global -> legacy store (demo mode) -> React.
describe('App scaffold', () => {
  it('lists the demo roster through the legacy store', async () => {
    localStorage.clear()
    render(<App />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect((await screen.findAllByRole('listitem')).length).toBeGreaterThan(0)
  })
})
