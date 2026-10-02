// Turns what a person typed (form input or CSV cell) into the value the
// database expects, or a plain-English error. Forms and CSV import share it,
// so a row that imports is exactly a row the form would accept.
import { parseBoolean, parseDate, parseMoney } from '../lib/format'
import type { FieldDef, Row } from './types'

export type Coerced = { ok: true; value: unknown } | { ok: false; error: string }

/** Label -> id index for one lookup field. Keys are lower-cased and trimmed. */
export interface LookupIndex {
  byKey: Map<string, string[]>
  labelById: Map<string, string>
}

export function buildLookupIndex(rows: Row[], field: FieldDef): LookupIndex {
  const byKey = new Map<string, string[]>()
  const labelById = new Map<string, string>()
  const lk = field.lookup!
  for (const r of rows) {
    const id = String(r.id)
    const label = lk.label(r)
    labelById.set(id, label)
    const keys = new Set([label, ...(lk.aliases?.(r) ?? [])].map((k) => k.trim().toLowerCase()).filter(Boolean))
    for (const k of keys) byKey.set(k, [...(byKey.get(k) ?? []), id])
  }
  return { byKey, labelById }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

export function coerce(field: FieldDef, raw: unknown, lookup?: LookupIndex): Coerced {
  const text = raw === null || raw === undefined ? '' : String(raw).trim()
  if (text === '' && field.type !== 'boolean') {
    return field.required ? { ok: false, error: `${field.label} is required` } : { ok: true, value: null }
  }
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'file':
      return { ok: true, value: text }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
        ? { ok: true, value: text.toLowerCase() }
        : { ok: false, error: `${field.label}: "${text}" is not an email address` }
    case 'number':
    case 'money':
    case 'percent': {
      const n = parseMoney(text.replace(/%$/, ''))
      if (n === null) return { ok: false, error: `${field.label}: "${text}" is not a number` }
      if (field.min !== undefined && n < field.min) return { ok: false, error: `${field.label} must be at least ${field.min}` }
      if (field.max !== undefined && n > field.max) return { ok: false, error: `${field.label} must be at most ${field.max}` }
      if (field.type === 'money') return { ok: true, value: Math.round(n * 100) / 100 }
      if (field.fraction) return { ok: true, value: Math.round(n * 10000) / 1000000 }
      return { ok: true, value: n }
    }
    case 'date': {
      const d = parseDate(text)
      return d ? { ok: true, value: d } : { ok: false, error: `${field.label}: "${text}" is not a date (use DD/MM/YYYY)` }
    }
    case 'boolean': {
      if (text === '') return field.required ? { ok: false, error: `${field.label} is required` } : { ok: true, value: field.default ?? false }
      const b = parseBoolean(text)
      return b === null ? { ok: false, error: `${field.label}: use Yes or No` } : { ok: true, value: b }
    }
    case 'select': {
      const opt = field.options!.find((o) => norm(o.value) === norm(text) || norm(o.label) === norm(text))
      return opt
        ? { ok: true, value: opt.value }
        : { ok: false, error: `${field.label}: "${text}" is not one of ${field.options!.map((o) => o.label).join(', ')}` }
    }
    case 'lookup': {
      if (!lookup) return { ok: false, error: `${field.label}: list not loaded` }
      // A pasted id is accepted as-is if it's one we know.
      if (lookup.labelById.has(text)) return { ok: true, value: text }
      const ids = lookup.byKey.get(text.toLowerCase())
      if (!ids || ids.length === 0) return { ok: false, error: `${field.label}: "${text}" not found` }
      if (ids.length > 1) return { ok: false, error: `${field.label}: "${text}" matches more than one record` }
      return { ok: true, value: ids[0] }
    }
  }
}

/** Value -> the text shown in lists and written to CSV exports. */
export function display(field: FieldDef, value: unknown, lookup?: LookupIndex): string {
  if (value === null || value === undefined || value === '') return ''
  switch (field.type) {
    case 'boolean': return value ? 'Yes' : 'No'
    case 'select': return field.options?.find((o) => o.value === value)?.label ?? String(value)
    case 'lookup': return lookup?.labelById.get(String(value)) ?? String(value)
    case 'percent': return field.fraction ? String(Math.round(Number(value) * 1000000) / 10000) : String(value)
    default: return String(value)
  }
}
