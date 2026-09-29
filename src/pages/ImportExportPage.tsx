import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { canWrite } from '../auth/roles'
import { Dialog } from '../components/Dialog'
import { CsvImport } from '../csv/CsvImport'
import { downloadCsv, exportCsv, rawCsv, templateCsv } from '../csv/csv'
import { RESOURCES } from '../resources/definitions'
import { fetchAll } from '../resources/ResourceList'
import type { ResourceDef } from '../resources/types'
import { fetchLookupRows, friendlyError } from '../resources/useLookups'
import { buildLookupIndex, type LookupIndex } from '../resources/coerce'
import { db } from '../lib/supabase'
import { todayAccra } from '../lib/format'

// Tables whose own screens (with lines, allocations or approvals) come next;
// until then they export as-is. RLS decides what each role gets.
const RAW_TABLES = [
  'invoices', 'invoice_lines', 'credit_notes', 'receipts', 'receipt_allocations', 'wht_certificates',
  'payments_out', 'payment_out_items', 'staff_payments', 'staff_loan_repayments', 'director_payments',
  'statutory_payments', 'payroll_runs', 'payroll_lines', 'payslips', 'timesheet_entries', 'leave_requests',
  'ledger_entries', 'statement_lines', 'reconciliations', 'month_closes', 'audit_log',
]

// The order to load go-live data (brief §10).
const GO_LIVE = ['accounts', 'clients', 'referrers', 'suppliers', 'jobs', 'billing_milestones', 'job_hour_budgets',
  'opening_invoices', 'statutory_lines', 'director_transactions', 'recurring_expenses', 'leave_entitlements', 'public_holidays']

async function exportResource(r: ResourceDef) {
  const rows = await fetchAll(r)
  const indexes: Record<string, LookupIndex> = {}
  for (const f of r.fields.filter((x) => x.lookup)) {
    indexes[f.name] = buildLookupIndex(await fetchLookupRows(f.lookup!).catch(() => []), f)
  }
  downloadCsv(`${r.key}-${todayAccra()}.csv`, exportCsv(r, rows, indexes, (r.extraListColumns ?? []).map((c) => c.name)))
}

export function ImportExportPage() {
  const { role } = useAuth()
  const [importing, setImporting] = useState<ResourceDef | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const readable = RESOURCES.filter((r) => role && r.readRoles.includes(role))
  const ordered = [...readable].sort((a, b) => {
    const ia = GO_LIVE.indexOf(a.key), ib = GO_LIVE.indexOf(b.key)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  async function raw(table: string) {
    setMessage(null)
    const { data, error } = await db.from(table).select('*').limit(50000)
    if (error) { setMessage(friendlyError(error)); return }
    if (!data?.length) { setMessage(`Nothing in ${table.replace(/_/g, ' ')} that you can see.`); return }
    downloadCsv(`${table}-${todayAccra()}.csv`, rawCsv(data))
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Import and export</h1>
          <p className="muted">Go-live data loads in the order shown. Every file is checked row by row before anything is saved, and the database applies the same rules as the forms.</p>
        </div>
      </header>
      {message && <p className="form-error">{message}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Template</th><th>Import</th><th>Export</th></tr></thead>
          <tbody>
            {ordered.map((r) => {
              const canImport = canWrite(role) && role !== null && r.importRoles.includes(role)
              return (
                <tr key={r.key}>
                  <td><strong>{r.title}</strong>{r.description && <div className="muted small">{r.description}</div>}</td>
                  <td>{canImport && <button className="link" onClick={() => downloadCsv(`${r.key}-template.csv`, templateCsv(r))}>Template</button>}</td>
                  <td>{canImport && <button onClick={() => setImporting(r)}>Import</button>}</td>
                  <td><button onClick={() => exportResource(r).catch((e) => setMessage(friendlyError(e)))}>Export</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>Other records (export)</h2>
      <p className="muted small">Exports everything your role can see, as stored.</p>
      <div className="chips">
        {RAW_TABLES.map((t) => <button key={t} onClick={() => raw(t)}>{t.replace(/_/g, ' ')}</button>)}
      </div>

      {importing && (
        <Dialog title={`Import ${importing.title.toLowerCase()}`} onClose={() => setImporting(null)}>
          <CsvImport resource={importing} onClose={() => setImporting(null)} />
        </Dialog>
      )}
    </section>
  )
}
