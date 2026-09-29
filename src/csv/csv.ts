// CSV import and export for every resource (brief §3 "CSV import and export
// for every main table, with downloadable templates"; acceptance 28).
// Pure functions: parsing, header mapping, validation, export.
import Papa from 'papaparse'
import { coerce, display, type LookupIndex } from '../resources/coerce'
import type { FieldDef, ResourceDef, Row } from '../resources/types'

export function importableFields(resource: ResourceDef): FieldDef[] {
  return resource.fields.filter((f) => f.csv !== false)
}

/** Header row using the friendly labels, marking required columns with *. */
export function templateCsv(resource: ResourceDef): string {
  const fields = importableFields(resource)
  const header = fields.map((f) => (f.required ? `${f.label} *` : f.label))
  const hints = fields.map((f) => {
    switch (f.type) {
      case 'date': return 'DD/MM/YYYY'
      case 'money': return '0.00'
      case 'boolean': return 'Yes/No'
      case 'select': return f.options!.map((o) => o.label).join(' | ')
      case 'lookup': return `name of existing ${f.label.toLowerCase()}`
      default: return ''
    }
  })
  // The hints row starts with "#" so it's skipped on import.
  return Papa.unparse([header, hints.map((h, i) => (i === 0 ? `# ${h}` : h))])
}

export interface HeaderMapping {
  /** CSV column index -> field */
  columns: Map<number, FieldDef>
  unknownHeaders: string[]
  missingRequired: FieldDef[]
}

const key = (s: string) => s.replace(/\*/g, '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')

export function mapHeaders(headers: string[], fields: FieldDef[]): HeaderMapping {
  const columns = new Map<number, FieldDef>()
  const unknownHeaders: string[] = []
  headers.forEach((h, i) => {
    const f = fields.find((x) => key(x.label) === key(h) || key(x.name) === key(h))
    if (f) columns.set(i, f)
    else if (h.trim()) unknownHeaders.push(h)
  })
  const mapped = new Set([...columns.values()].map((f) => f.name))
  const missingRequired = fields.filter((f) => f.required && !mapped.has(f.name))
  return { columns, unknownHeaders, missingRequired }
}

export interface ParsedRow {
  /** 1-based line number in the file, for error messages. */
  line: number
  values: Row
  errors: string[]
}

export interface ParseResult {
  mapping: HeaderMapping
  rows: ParsedRow[]
  fileErrors: string[]
}

export function parseImport(
  text: string,
  resource: ResourceDef,
  lookups: Record<string, LookupIndex>,
): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  const fileErrors = parsed.errors
    .filter((e) => e.code !== 'UndetectableDelimiter')   // a one-column file is fine
    .map((e) => `Line ${(e.row ?? 0) + 1}: ${e.message}`)
  const [headers = [], ...body] = parsed.data
  const fields = importableFields(resource)
  const mapping = mapHeaders(headers, fields)
  if (mapping.missingRequired.length) {
    fileErrors.push(`Missing required column(s): ${mapping.missingRequired.map((f) => f.label).join(', ')}`)
  }

  const rows: ParsedRow[] = []
  body.forEach((cells, i) => {
    if (cells.length && String(cells[0]).trim().startsWith('#')) return
    const values: Row = { ...(resource.importDefaults ?? {}) }
    const errors: string[] = []
    for (const [col, field] of mapping.columns) {
      const res = coerce(field, cells[col], field.lookup ? lookups[field.name] : undefined)
      if (res.ok) { if (res.value !== null) values[field.name] = res.value }
      else errors.push(res.error)
    }
    for (const f of mapping.missingRequired) errors.push(`${f.label} is required`)
    rows.push({ line: i + 2, values, errors })
  })
  return { mapping, rows, fileErrors }
}

/** Rows as the database returns them -> CSV with labels instead of ids. */
export function exportCsv(resource: ResourceDef, rows: Row[], lookups: Record<string, LookupIndex>, extra: string[] = []): string {
  const fields = importableFields(resource)
  const header = [...fields.map((f) => f.label), ...extra]
  const body = rows.map((r) => [
    ...fields.map((f) => display(f, r[f.name], f.lookup ? lookups[f.name] : undefined)),
    ...extra.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c]))),
  ])
  return Papa.unparse([header, ...body])
}

/** Any table, all columns, as returned (for tables without a resource config). */
export function rawCsv(rows: Row[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  return Papa.unparse({
    fields: cols,
    data: rows.map((r) => cols.map((c) => {
      const v = r[c]
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    })),
  })
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel opens UTF-8 (e.g. "₵", accented names) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
