import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { canWrite } from '../auth/roles'
import { CsvImport } from '../csv/CsvImport'
import { downloadCsv, exportCsv } from '../csv/csv'
import { formatDate, formatMoney } from '../lib/format'
import { db } from '../lib/supabase'
import { Dialog } from '../components/Dialog'
import { display } from './coerce'
import { primaryKeyOf, ResourceForm, visibleFields } from './ResourceForm'
import type { FieldDef, ResourceDef, Row } from './types'
import { friendlyError, useLookupIndexes } from './useLookups'

export async function fetchAll(resource: ResourceDef): Promise<Row[]> {
  let q = db.from(resource.table).select('*')
  for (const [col, val] of Object.entries(resource.listFilter ?? {})) q = q.eq(col, val)
  const { data, error } = await q
    .order(resource.orderBy.column, { ascending: resource.orderBy.ascending ?? true, nullsFirst: false })
    .limit(10000)
  if (error) throw error
  return (data ?? []) as Row[]
}

function cell(f: Pick<FieldDef, 'type' | 'name'> & Partial<FieldDef>, value: unknown, text: string) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>
  if (f.type === 'money') return <span className="num">{formatMoney(value as number, false)}</span>
  if (f.type === 'date') return formatDate(String(value))
  return text
}

export function ResourceList({ resource }: { resource: ResourceDef }) {
  const { role } = useAuth()
  const fields = useMemo(() => visibleFields(resource, role), [resource, role])
  const listFields = fields.filter((f) => f.list)
  const { indexes } = useLookupIndexes(fields)
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['resource', resource.table, resource.key],
    queryFn: () => fetchAll(resource),
  })
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const writer = canWrite(role)
  const canCreate = writer && role !== null && resource.createRoles.includes(role)
  const canImport = writer && role !== null && resource.importRoles.includes(role)

  const text = (f: FieldDef, r: Row) => display(f, r[f.name], indexes[f.name])
  const filtered = search.trim()
    ? rows.filter((r) => listFields.some((f) => text(f, r).toLowerCase().includes(search.trim().toLowerCase())))
    : rows

  return (
    <section>
      <header className="page-header">
        <div>
          <h1>{resource.title}</h1>
          {resource.description && <p className="muted">{resource.description}</p>}
        </div>
        <div className="actions">
          {canCreate && <button className="primary" onClick={() => setEditing('new')}>+ New {resource.singular.toLowerCase()}</button>}
          {canImport && <button onClick={() => setImporting(true)}>Import CSV</button>}
          <button onClick={() => downloadCsv(`${resource.key}.csv`, exportCsv(resource, filtered, indexes,
                   (resource.extraListColumns ?? []).map((c) => c.name)))} disabled={rows.length === 0}>Export CSV</button>
        </div>
      </header>

      <input className="search" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {error && <p className="form-error">{friendlyError(error as Error)}</p>}
      {isLoading ? <p className="muted">Loading…</p> : filtered.length === 0 ? (
        <p className="empty">{rows.length === 0 ? `No ${resource.title.toLowerCase()} yet.` : 'Nothing matches your search.'}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {listFields.map((f) => <th key={f.name} className={f.type === 'money' ? 'num' : undefined}>{f.label}</th>)}
                {(resource.extraListColumns ?? []).map((c) => <th key={c.name} className={c.type === 'money' ? 'num' : undefined}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={JSON.stringify(primaryKeyOf(resource, r))} className="clickable" onClick={() => setEditing(r)}>
                  {listFields.map((f) => <td key={f.name}>{cell(f, r[f.name], text(f, r))}</td>)}
                  {(resource.extraListColumns ?? []).map((c) => (
                    <td key={c.name}>{cell(c, r[c.name], String(r[c.name] ?? '').replace(/_/g, ' '))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{filtered.length} of {rows.length}</p>

      {editing && (
        <Dialog title={editing === 'new' ? `New ${resource.singular.toLowerCase()}` : resource.singular} onClose={() => setEditing(null)}>
          <ResourceForm resource={resource} row={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        </Dialog>
      )}
      {importing && (
        <Dialog title={`Import ${resource.title.toLowerCase()}`} onClose={() => setImporting(false)}>
          <CsvImport resource={resource} onClose={() => setImporting(false)} />
        </Dialog>
      )}
    </section>
  )
}
