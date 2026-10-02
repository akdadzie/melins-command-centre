import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { db } from '../lib/supabase'
import { coerce, display } from './coerce'
import type { FieldDef, ResourceDef, Row } from './types'
import { friendlyError, useLookupIndexes } from './useLookups'

type Values = Record<string, string | boolean>

function initialValue(f: FieldDef, row: Row | null): string | boolean {
  const v = row ? row[f.name] : typeof f.default === 'function' ? (f.default as () => unknown)() : f.default
  if (f.type === 'boolean') return Boolean(v)
  if (v === null || v === undefined) return ''
  if (f.type === 'percent') return display(f, v)
  return String(v)
}

export function visibleFields(resource: ResourceDef, role: string | null) {
  return resource.fields.filter((f) => !f.hiddenFor?.includes(role as never))
}

export function primaryKeyOf(resource: ResourceDef, row: Row): Record<string, unknown> {
  return Object.fromEntries((resource.primaryKey ?? ['id']).map((k) => [k, row[k]]))
}

interface Props {
  resource: ResourceDef
  /** null = create */
  row: Row | null
  onDone: (saved: Row | null) => void
  /** Values for a new record, e.g. the job a milestone is added to. */
  preset?: Row
  /** Fields not shown (their preset value is still saved). */
  hide?: string[]
}

export function ResourceForm({ resource, row, onDone, preset, hide }: Props) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const fields = useMemo(() => visibleFields(resource, role), [resource, role])
  const { indexes, options, loading } = useLookupIndexes(fields)
  const [values, setValues] = useState<Values>(() => Object.fromEntries(fields.map((f) =>
    [f.name, !row && preset && f.name in preset ? initialValue(f, preset) : initialValue(f, row)])))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = row !== null
  const canSave = role !== null && (editing ? resource.editRoles : resource.createRoles).includes(role)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const out: Row = {}
    const errs: Record<string, string> = {}
    for (const f of fields) {
      if (editing && f.createOnly) continue
      if (hide?.includes(f.name) && !(preset && f.name in preset && !editing)) continue
      const raw = values[f.name]
      const res = coerce(f, f.type === 'boolean' ? (raw ? 'yes' : 'no') : raw, indexes[f.name])
      if (res.ok) out[f.name] = res.value
      else errs[f.name] = res.error
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true); setFormError(null)
    const q = editing
      ? db.from(resource.table).update(out).match(primaryKeyOf(resource, row!)).select().maybeSingle()
      : db.from(resource.table).insert({ ...(resource.createDefaults ?? {}), ...out }).select().maybeSingle()
    const { data, error } = await q
    setBusy(false)
    if (error) { setFormError(friendlyError(error)); return }
    if (editing && !data) { setFormError('Nothing was saved: you may not have permission to change this record.'); return }
    await qc.invalidateQueries({ queryKey: ['resource', resource.table] })
    await qc.invalidateQueries({ queryKey: ['lookup', resource.table] })
    onDone((data as Row) ?? null)
  }

  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }))

  return (
    <form className="resource-form" onSubmit={submit} noValidate>
      {loading && <p className="muted small">Loading lists…</p>}
      <div className="form-grid">
        {fields.filter((f) => !hide?.includes(f.name)).map((f) => {
          const disabled = !canSave || (editing && f.createOnly)
          const id = `f-${resource.key}-${f.name}`
          const v = values[f.name]
          let input
          switch (f.type) {
            case 'boolean':
              input = <input id={id} type="checkbox" checked={Boolean(v)} disabled={disabled} onChange={(e) => set(f.name, e.target.checked)} />
              break
            case 'textarea':
              input = <textarea id={id} value={String(v)} disabled={disabled} rows={3} onChange={(e) => set(f.name, e.target.value)} />
              break
            case 'select':
              input = (
                <select id={id} value={String(v)} disabled={disabled} onChange={(e) => set(f.name, e.target.value)}>
                  {!f.required && <option value="">—</option>}
                  {f.required && v === '' && <option value="">Choose…</option>}
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )
              break
            case 'lookup':
              input = (
                <select id={id} value={String(v)} disabled={disabled} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">{f.required ? 'Choose…' : '—'}</option>
                  {(options[f.name] ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )
              break
            case 'date':
              input = <input id={id} type="date" value={String(v)} disabled={disabled} onChange={(e) => set(f.name, e.target.value)} />
              break
            case 'money':
            case 'number':
            case 'percent':
              input = <input id={id} type="text" inputMode="decimal" value={String(v)} disabled={disabled} onChange={(e) => set(f.name, e.target.value)} />
              break
            default:
              input = <input id={id} type={f.type === 'email' ? 'email' : 'text'} value={String(v)} disabled={disabled} onChange={(e) => set(f.name, e.target.value)} />
          }
          return (
            <div key={f.name} className={`field field-${f.type}${errors[f.name] ? ' has-error' : ''}`}>
              <label htmlFor={id}>{f.label}{f.required && <span className="req" aria-hidden> *</span>}{f.type === 'money' && <span className="unit"> GHS</span>}{f.type === 'percent' && <span className="unit"> %</span>}</label>
              {input}
              {errors[f.name] ? <span className="field-error">{errors[f.name]}</span> : f.help && <span className="help">{f.help}</span>}
            </div>
          )
        })}
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="form-actions">
        {canSave && <button className="primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : `Add ${resource.singular.toLowerCase()}`}</button>}
        <button type="button" onClick={() => onDone(null)}>{canSave ? 'Cancel' : 'Close'}</button>
      </div>
    </form>
  )
}
