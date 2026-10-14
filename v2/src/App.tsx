import { useEffect, useState } from 'react'
import { store } from '@legacy/store/index.js'

interface Employee {
  id: string
  name: string
  active: boolean
}

// Scaffold proof only: reads the roster through the legacy store (demo store by default) to show
// the bridge works end to end. The real kiosk replaces this in plan step 2.
export function App() {
  const [employees, setEmployees] = useState<Employee[] | null>(null)

  useEffect(() => {
    let cancelled = false
    // demoStore returns the array directly, supabaseStore a promise: await handles both.
    Promise.resolve(store.listEmployees()).then((list: Employee[]) => {
      if (!cancelled) setEmployees(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main style={{ padding: 'var(--space-5)' }}>
      <h1 className="title-1">Unitech Attendance 2.0</h1>
      {employees === null ? (
        <p className="body">Loading…</p>
      ) : (
        <ul className="tc-queue" style={{ maxWidth: 420 }}>
          {employees.map((e) => (
            <li key={e.id} className="tc-queue__row">
              <span className="tc-avatar">{e.name.slice(0, 2).toUpperCase()}</span>
              <span className="tc-queue__title">{e.name}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
