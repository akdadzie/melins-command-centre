import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { Money, StatusBadge, Tabs } from '../../components/ui'
import { formatDate, todayAccra } from '../../lib/format'
import { db } from '../../lib/supabase'
import { lookups } from '../../resources/lookups'
import { fetchLookupRows, friendlyError } from '../../resources/useLookups'
import { listInvoices, type InvoiceListRow } from './api'

type TabKey = 'drafts' | 'approval' | 'open' | 'paid' | 'all'

const inTab = (t: TabKey, i: InvoiceListRow) => {
  switch (t) {
    case 'drafts': return i.status === 'draft' && !i.ready_for_approval
    case 'approval': return i.status === 'draft' && i.ready_for_approval
    case 'open': return ['approved', 'sent', 'part_paid', 'disputed'].includes(i.status)
    case 'paid': return i.status === 'paid' || i.status === 'written_off'
    case 'all': return true
  }
}

export function InvoicesPage() {
  const { role } = useAuth()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['invoices'], queryFn: listInvoices })
  const [tab, setTab] = useState<TabKey>(role === 'owner' ? 'approval' : role === 'project_lead' ? 'drafts' : 'open')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const canDraft = canWrite(role) && ['owner', 'accountant', 'admin', 'project_lead'].includes(role ?? '')

  const counts = useMemo(() => Object.fromEntries((['drafts', 'approval', 'open', 'paid', 'all'] as TabKey[])
    .map((t) => [t, data.filter((i) => inTab(t, i)).length])), [data])
  const q = search.trim().toLowerCase()
  const rows = data.filter((i) => inTab(tab, i)).filter((i) => !q ||
    [i.invoice_number, i.draft_ref, i.job?.job_number, i.job?.title, i.client?.name].some((s) => s?.toLowerCase().includes(q)))

  return (
    <section>
      <header className="page-header">
        <div><h1>Invoices</h1><p className="muted">An invoice gets its number only when approved. Admin drafts; the Owner approves.</p></div>
        <div className="actions">{canDraft && <button className="primary" onClick={() => setCreating(true)}>+ New invoice</button>}</div>
      </header>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'drafts', label: 'Drafts', count: counts.drafts }, { key: 'approval', label: 'Awaiting approval', count: counts.approval },
        { key: 'open', label: 'Open', count: counts.open }, { key: 'paid', label: 'Paid / written off' }, { key: 'all', label: 'All' }]} />
      <input className="search" type="search" placeholder="Search number, job or client…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {error && <p className="form-error">{friendlyError(error as Error)}</p>}
      {isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">No invoices here.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Job</th><th>Client</th><th>Date</th><th>Due</th><th className="num">Gross</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
          <tbody>{rows.map((i) => {
            const key = i.invoice_number ?? i.draft_ref
            return (
              <tr key={i.id}>
                <td><Link to={`/invoices/${key}`}>{key}</Link>{i.is_imported && <span className="muted small"> (opening)</span>}</td>
                <td>{i.job?.job_number} <span className="muted">{i.job?.title}</span></td>
                <td>{i.client?.name}</td>
                <td>{formatDate(i.invoice_date)}</td>
                <td>{formatDate(i.due_date)}</td>
                <td><Money value={i.gross_total} /></td>
                <td>{i.status === 'draft' ? '' : <Money value={i.outstanding} />}</td>
                <td><StatusBadge status={i.ready_for_approval && i.status === 'draft' ? 'submitted' : i.status}
                                  label={i.ready_for_approval && i.status === 'draft' ? 'awaiting approval' : undefined} /></td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
      {creating && <NewInvoice onClose={() => setCreating(false)} />}
    </section>
  )
}

function NewInvoice({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const jobs = useQuery({ queryKey: ['lookup', 'jobs', 'invoice'], queryFn: () => fetchLookupRows(lookups.job) })
  const [jobId, setJobId] = useState('')
  const [date, setDate] = useState(todayAccra())
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // client_id, retention, WHT and terms are filled in by the database from the job.
    const { data, error } = await db.from('invoices').insert({ job_id: jobId, invoice_date: date }).select('draft_ref').single()
    if (error) { setError(friendlyError(error)); return }
    await qc.invalidateQueries({ queryKey: ['invoices'] })
    navigate(`/invoices/${data.draft_ref}`)
  }

  return (
    <Dialog title="New invoice" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} required>
            <option value="">Choose…</option>
            {(jobs.data ?? []).map((j) => <option key={String(j.id)} value={String(j.id)}>{lookups.job.label(j)}</option>)}
          </select>
        </label>
        <label>Invoice date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <p className="muted small">The client, retention, WHT and payment terms come from the job and client. You add the lines next.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><button className="primary">Create draft</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}
