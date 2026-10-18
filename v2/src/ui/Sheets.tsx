import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export interface FieldDef {
  name: string
  label: string
  type?: 'time' | 'number' | 'text' | 'date' | 'select'
  /** For a select: the choices. The first is chosen unless `value` names another. */
  options?: { value: string; label: string }[]
  value?: string
  placeholder?: string
  help?: string
  /** Defaults to true. An optional clock-out passes false. */
  required?: boolean
  /** A PIN is text, but the on-screen keyboard should be the number pad. */
  inputMode?: 'numeric' | 'decimal' | 'text'
  maxLength?: number
}

/** A message for the whole form, or one pinned under a field. */
export type Problem = string | { field: string; message: string }

export interface PromptConfig {
  title: string
  note?: string[]
  fields: FieldDef[]
  submitLabel?: string
  /** Delete-style confirmation: the submit button is the outlined red one. */
  danger?: boolean
  validate?: (values: Record<string, string>) => Problem | null
}

export interface ChoiceConfig {
  title: string
  items: { label: string; danger?: boolean }[]
}

type Values = Record<string, string>

interface Sheets {
  /** Resolves with the typed values on Save (an empty object for a confirm), or null on Cancel. */
  prompt: (c: PromptConfig) => Promise<Values | null>
  /** Resolves with the chosen item's index, or null. */
  choose: (c: ChoiceConfig) => Promise<number | null>
}

const Ctx = createContext<Sheets | null>(null)

export function useSheets(): Sheets {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSheets needs a <SheetsProvider>')
  return s
}

type Open = { kind: 'prompt'; config: PromptConfig; resolve: (v: Values | null) => void } | { kind: 'choice'; config: ChoiceConfig; resolve: (i: number | null) => void }

/** The app's one modal form. Replaces the live app's prompt()-style modal; wording is the Dialogs board's. */
export function SheetsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)

  const prompt = useCallback((config: PromptConfig) => new Promise<Values | null>((resolve) => setOpen({ kind: 'prompt', config, resolve })), [])
  const choose = useCallback((config: ChoiceConfig) => new Promise<number | null>((resolve) => setOpen({ kind: 'choice', config, resolve })), [])
  const value = useMemo(() => ({ prompt, choose }), [prompt, choose])

  return (
    <Ctx.Provider value={value}>
      {children}
      {open?.kind === 'prompt' && (
        <PromptSheet
          config={open.config}
          onClose={(v) => {
            open.resolve(v)
            setOpen(null)
          }}
        />
      )}
      {open?.kind === 'choice' && (
        <ChoiceSheet
          config={open.config}
          onClose={(i) => {
            open.resolve(i)
            setOpen(null)
          }}
        />
      )}
    </Ctx.Provider>
  )
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
  }, [])
  return ref
}

function PromptSheet({ config, onClose }: { config: PromptConfig; onClose: (v: Values | null) => void }) {
  const ref = useModal()
  const [values, setValues] = useState<Values>(() => Object.fromEntries(config.fields.map((f) => [f.name, f.value ?? f.options?.[0]?.value ?? ''])))
  const [problem, setProblem] = useState<{ field: string | null; message: string } | null>(null)
  const first = config.fields[0]?.name

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed: Values = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]))
    for (const f of config.fields) {
      if ((f.required ?? true) && !trimmed[f.name]) return setProblem({ field: f.name, message: 'Please fill in all fields.' })
    }
    const found = config.validate?.(trimmed) ?? null
    if (found) return setProblem(typeof found === 'string' ? { field: null, message: found } : found)
    onClose(trimmed)
  }

  return (
    <dialog ref={ref} className="sheet-dialog" aria-labelledby="sheet-title" onCancel={(e) => { e.preventDefault(); onClose(null) }}>
      <form className="tc-sheet" onSubmit={submit} noValidate>
        <div>
          <h2 id="sheet-title" className="title-2" style={{ margin: 0 }}>{config.title}</h2>
          {config.note && config.note.length > 0 && (
            <div className="body app-muted" style={{ marginTop: 4 }}>{config.note.map((l, i) => <div key={i}>{l}</div>)}</div>
          )}
        </div>
        {config.fields.map((f) => {
          const bad = problem?.field === f.name
          return (
            <div key={f.name} className="tc-field">
              <label className="tc-field__label" htmlFor={`sheet-${f.name}`}>{f.label}</label>
              {f.type === 'select' ? (
                <select
                  id={`sheet-${f.name}`}
                  className="tc-field__input"
                  autoFocus={f.name === first}
                  value={values[f.name]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                >
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  id={`sheet-${f.name}`}
                  className="tc-field__input tc-field__input--time"
                  type={f.type ?? 'text'}
                  inputMode={f.inputMode ?? (f.type === 'number' ? 'decimal' : undefined)}
                  maxLength={f.maxLength}
                  step={f.type === 'number' ? 'any' : undefined}
                  placeholder={f.placeholder}
                  autoFocus={f.name === first}
                  value={values[f.name]}
                  aria-invalid={bad ? true : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
              {bad ? <span className="tc-field__error" role="alert">{problem!.message}</span> : f.help ? <span className="tc-field__help">{f.help}</span> : null}
            </div>
          )
        })}
        {problem && problem.field === null && <div className="app-error" role="alert">{problem.message}</div>}
        <div className="tc-sheet__actions">
          <button type="submit" className={`tc-btn ${config.danger ? 'tc-btn--danger' : 'tc-btn--primary'}`} style={config.danger ? { flex: 1 } : undefined}>
            {config.submitLabel ?? 'Save'}
          </button>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={() => onClose(null)}>Cancel</button>
        </div>
      </form>
    </dialog>
  )
}

function ChoiceSheet({ config, onClose }: { config: ChoiceConfig; onClose: (i: number | null) => void }) {
  const ref = useModal()
  return (
    <dialog ref={ref} className="sheet-dialog" aria-labelledby="choice-title" onCancel={(e) => { e.preventDefault(); onClose(null) }}>
      <div className="tc-sheet">
        <h2 id="choice-title" className="title-2" style={{ margin: 0 }}>{config.title}</h2>
        <ul className="tc-sheet__list">
          {config.items.map((it, i) => (
            <li key={it.label}>
              <button type="button" className="tc-sheet__item" style={{ width: '100%', ...(it.danger ? { color: 'var(--alert-ink)' } : null) }} onClick={() => onClose(i)}>{it.label}</button>
            </li>
          ))}
        </ul>
        <button type="button" className="tc-btn tc-btn--secondary" onClick={() => onClose(null)}>Cancel</button>
      </div>
    </dialog>
  )
}
