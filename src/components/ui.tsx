import { useState, type FormEvent, type ReactNode } from 'react'
import { formatMoney } from '../lib/format'
import { Dialog } from './Dialog'

const TONES: Record<string, 'neutral' | 'info' | 'warn' | 'ok' | 'bad'> = {
  draft: 'neutral', prepared: 'neutral', imported: 'neutral', submitted: 'info', requested: 'info', recorded: 'info',
  reported: 'warn', approved: 'info', sent: 'info', part_paid: 'warn', disputed: 'bad', returned: 'bad', queried: 'bad',
  paid: 'ok', confirmed: 'ok', reviewed: 'ok', issued: 'ok', reimbursed: 'ok', received: 'ok', claimed: 'ok',
  written_off: 'bad', rejected: 'bad', cancelled: 'neutral', expected: 'warn', overdue: 'bad', due: 'info',
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return null
  return <span className={`badge badge-${TONES[status] ?? 'neutral'}`}>{label ?? status.replace(/_/g, ' ')}</span>
}

export function Money({ value, strong }: { value: number | string | null | undefined; strong?: boolean }) {
  const s = formatMoney(value, false)
  return <span className="num">{strong ? <strong>{s}</strong> : s}</span>
}

/** Asks for a reason (or other short text) before running an action. */
export function PromptDialog({ title, label, confirmLabel, onSubmit, onClose, extra }: {
  title: string
  label: string
  confirmLabel: string
  onSubmit: (value: string) => Promise<string | null>
  onClose: () => void
  extra?: ReactNode
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const err = await onSubmit(value.trim())
    setBusy(false)
    if (err) setError(err); else onClose()
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {extra}
        <label>{label}<input value={value} onChange={(e) => setValue(e.target.value)} required autoFocus /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button className="primary" disabled={busy}>{confirmLabel}</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}

/** Runs an async action, tracking busy state and a user-facing error. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<string | null | void>) {
    setBusy(true); setError(null)
    try {
      const err = await fn()
      if (err) setError(err)
      return !err
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && t.count > 0 && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function uuid(): string {
  return crypto.randomUUID()
}
