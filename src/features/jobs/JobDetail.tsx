// /jobs/:number (brief §5, §7.3). Tabs by role: Owner, Directors and the
// Accountant see everything; the Project lead everything but costing; Admin
// the overview, billing and contracts; Staff their own job's overview.
// Phase A tabs: overview, hour budget, milestones, invoices, contracts.
// Valuations, subcontracts, hire, site costs, trips and costing are Phase B.
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite, type Role } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { Money, StatusBadge, Tabs, useAction } from '../../components/ui'
import { formatDate, formatMoney, todayAccra } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import * as R from '../../resources/definitions'
import { ResourceForm } from '../../resources/ResourceForm'
import type { Row } from '../../resources/types'
import { friendlyError } from '../../resources/useLookups'

type TabKey = 'overview' | 'budget' | 'milestones' | 'invoices' | 'contracts' | 'costing'

const TABS: Record<TabKey, { label: string; roles: Role[] }> = {
  overview: { label: 'Overview', roles: ['owner', 'director', 'accountant', 'admin', 'project_lead', 'staff'] },
  budget: { label: 'Hours budget', roles: ['owner', 'director', 'accountant', 'project_lead'] },
  milestones: { label: 'Milestones', roles: ['owner', 'director', 'accountant', 'admin', 'project_lead'] },
  invoices: { label: 'Invoices', roles: ['owner', 'director', 'accountant', 'admin'] },
  contracts: { label: 'Contracts', roles: ['owner', 'director', 'accountant', 'admin', 'project_lead'] },
  costing: { label: 'Costing', roles: ['owner', 'director', 'accountant'] },
}

const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')
const FEE_BASIS: Record<string, string> = { lump_sum: 'Lump sum', percent_of_construction: '% of construction cost', monthly: 'Monthly', time_based: 'Time-based' }

export function JobDetail() {
  const { number = '' } = useParams()
  const { role } = useAuth()
  if (role === 'staff') return <StaffJob number={number} />
  return <FullJob number={number} />
}

/** Staff see their own job's name, deadlines and status only (brief §4). */
function StaffJob({ number }: { number: string }) {
  const job = useQuery({
    queryKey: ['my-job', number],
    queryFn: async () => (await supabase.from('my_jobs').select('*').eq('job_number', number).maybeSingle()).data,
  })
  if (job.isLoading) return <p className="muted">Loading…</p>
  const j = job.data
  if (!j) return <section><h1>Job {number}</h1><p className="empty">Not found, or you're not on this job.</p></section>
  return (
    <section>
      <p className="small"><Link to="/jobs">My jobs</Link></p>
      <h1>{j.job_number} {j.title}</h1>
      <p className="muted">{j.client_name}</p>
      <dl className="facts">
        <dt>Status</dt><dd>{label(j.delivery_status)}</dd>
        <dt>Start</dt><dd>{formatDate(j.start_date)}</dd>
        <dt>Due</dt><dd>{formatDate(j.due_date)}</dd>
        <dt>Complete</dt><dd>{Number(j.percent_complete ?? 0)}%</dd>
      </dl>
      <p className="muted small">Your tasks on this job arrive with Tasks in Phase B.</p>
    </section>
  )
}

async function fetchJob(number: string) {
  const { data, error } = await supabase.from('jobs')
    .select('*, client:clients(name), job_type:job_types(name), referrer:referrers(name), lead:project_lead_staff_id(full_name)')
    .eq('job_number', number).maybeSingle()
  if (error) throw error
  return data
}
type Job = NonNullable<Awaited<ReturnType<typeof fetchJob>>>

function FullJob({ number }: { number: string }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const job = useQuery({ queryKey: ['job', number], queryFn: () => fetchJob(number) })
  const j = job.data
  const tabs = (Object.keys(TABS) as TabKey[]).filter((k) => role && TABS[k].roles.includes(role))
  const requested = params.get('tab') as TabKey | null
  const tab: TabKey = requested && tabs.includes(requested) ? requested : 'overview'

  if (job.isLoading) return <p className="muted">Loading…</p>
  if (!j) return <section><h1>Job {number}</h1><p className="empty">Not found, or your role can't see it.</p></section>
  const mayEdit = canWrite(role) && R.jobs.editRoles.includes(role!)

  return (
    <section>
      <p className="small"><Link to="/jobs">Jobs</Link></p>
      <header className="page-header">
        <div>
          <h1>{j.job_number} {j.title}</h1>
          <p className="muted">{j.client?.name} · {j.contract_mode === 'design_build' ? 'Design and build' : 'Consultancy'}
            {j.job_type && <> · {j.job_type.name}</>}{j.is_goodwill && <> · <strong>Goodwill</strong></>}</p>
        </div>
        <div className="actions">
          <StatusBadge status={j.delivery_status} />
          {mayEdit && <button onClick={() => setEditing(true)}>Edit job</button>}
        </div>
      </header>
      <Tabs value={tab} onChange={(k) => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })}
        tabs={tabs.map((k) => ({ key: k, label: TABS[k].label }))} />
      {tab === 'overview' && <Overview job={j} />}
      {tab === 'budget' && <HoursBudget jobId={j.id} />}
      {tab === 'milestones' && <Milestones job={j} />}
      {tab === 'invoices' && <JobInvoices jobId={j.id} />}
      {tab === 'contracts' && <Contracts jobId={j.id} />}
      {tab === 'costing' && <p className="empty">Job costing (staff time at frozen rates, direct costs and margin) arrives in Phase B. Approved timesheets are already freezing the rates it will use.</p>}
      {editing && (
        <Dialog title={`Edit ${j.job_number}`} onClose={() => setEditing(false)}>
          <ResourceForm resource={R.jobs} row={j as unknown as Row} onDone={async () => {
            setEditing(false)
            await qc.invalidateQueries({ queryKey: ['job', number] })
          }} />
        </Dialog>
      )}
    </section>
  )
}


function Overview({ job: j }: { job: Job }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const action = useAction()
  const [adding, setAdding] = useState('')
  const money = useQuery({
    queryKey: ['job-money', j.id],
    queryFn: async () => (await supabase.from('job_money_status').select('*').eq('job_id', j.id).maybeSingle()).data,
  })
  const retention = useQuery({
    queryKey: ['job-retention', j.id],
    enabled: role !== 'project_lead',
    queryFn: async () => (await supabase.from('retention_by_job').select('retention_held').eq('job_id', j.id).maybeSingle()).data,
  })
  const team = useQuery({
    queryKey: ['job-team', j.id],
    queryFn: async () => (await supabase.from('job_team').select('staff_id, staff:staff(full_name, job_title)').eq('job_id', j.id)).data ?? [],
  })
  const staff = useQuery({
    queryKey: ['staff-active'],
    enabled: role === 'owner' || role === 'project_lead',
    queryFn: async () => (await supabase.from('staff').select('id, full_name').eq('is_active', true).order('full_name')).data ?? [],
  })
  const manageTeam = canWrite(role) && (role === 'owner' || role === 'project_lead')
  const onTeam = new Set((team.data ?? []).map((t) => t.staff_id))
  const refreshTeam = () => qc.invalidateQueries({ queryKey: ['job-team', j.id] })

  return (
    <div className="detail-grid">
      <div className="panel">
        <h3>Contract</h3>
        <dl className="facts">
          <dt>Fee{j.contract_mode === 'design_build' ? ' (contract sum)' : ''}</dt><dd><Money value={j.fee} /> <span className="muted small">{FEE_BASIS[j.fee_basis]}</span></dd>
          {j.fee_basis === 'percent_of_construction' && <><dt>Construction value</dt><dd><Money value={j.construction_value} /> × {Number(j.fee_percent)}%</dd></>}
          <dt>Retention</dt><dd>{Number(j.retention_pct)}% of {j.retention_basis} {j.retention_release_terms && <span className="muted small">· {j.retention_release_terms}</span>}</dd>
          {j.retention_release_date && <><dt>Expected release</dt><dd>{formatDate(j.retention_release_date)}</dd></>}
          <dt>Referred by</dt><dd>{j.referrer?.name ?? '—'}</dd>
          <dt>Start</dt><dd>{formatDate(j.start_date)}</dd>
          <dt>Due</dt><dd>{formatDate(j.due_date)}{j.due_date && j.due_date < todayAccra() && !['completed', 'closed'].includes(j.delivery_status) && <span className="warn-text small"> past due</span>}</dd>
          <dt>Complete</dt><dd>{Number(j.percent_complete)}%</dd>
          <dt>Project lead</dt><dd>{j.lead?.full_name ?? '—'}</dd>
        </dl>
        {j.notes && <p className="small">{j.notes}</p>}
      </div>
      <div className="stack">
        {money.data && (
          <div className="panel">
            <h3>Money <StatusBadge status={money.data.money_status === 'paid' ? 'paid' : money.data.money_status === 'part_paid' ? 'part_paid' : 'draft'} label={label(money.data.money_status)} /></h3>
            <dl className="facts">
              <dt>Invoiced (net)</dt><dd><Money value={money.data.invoiced_net} /></dd>
              <dt>Settled</dt><dd><Money value={money.data.settled} /></dd>
              {retention.data && <><dt>Retention held</dt><dd><Money value={retention.data.retention_held} /></dd></>}
            </dl>
          </div>
        )}
        <div className="panel">
          <h3>Team</h3>
          {(team.data ?? []).length === 0 ? <p className="muted small">Nobody added yet. Staff only see jobs they're on.</p> : (
            <ul className="plain">{(team.data ?? []).map((t) => (
              <li key={t.staff_id} className="row-actions" style={{ justifyContent: 'space-between' }}>
                <span>{t.staff?.full_name} <span className="muted small">{t.staff?.job_title}</span></span>
                {manageTeam && <button className="link" disabled={action.busy} onClick={() => action.run(async () => {
                  const { error } = await supabase.from('job_team').delete().eq('job_id', j.id).eq('staff_id', t.staff_id)
                  if (error) return friendlyError(error)
                  await refreshTeam()
                })}>Remove</button>}
              </li>
            ))}</ul>
          )}
          {manageTeam && (
            <form className="row-actions" style={{ marginTop: '.75rem' }} onSubmit={(e) => {
              e.preventDefault()
              if (!adding) return
              action.run(async () => {
                const { error } = await supabase.from('job_team').insert({ job_id: j.id, staff_id: adding })
                if (error) return friendlyError(error)
                setAdding(''); await refreshTeam()
              })
            }}>
              <select value={adding} onChange={(e) => setAdding(e.target.value)} style={{ flex: 1 }} aria-label="Add to team">
                <option value="">Add someone…</option>
                {(staff.data ?? []).filter((s) => !onTeam.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <button disabled={!adding || action.busy}>Add</button>
            </form>
          )}
          {action.error && <p className="form-error">{action.error}</p>}
        </div>
      </div>
    </div>
  )
}

/** Hours by budget role vs logged (brief §7.3; acceptance 35). */
function HoursBudget({ jobId }: { jobId: string }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['budget-roles'], queryFn: async () => (await supabase.from('budget_roles').select('id, name').order('name')).data ?? [] })
  const budgets = useQuery({
    queryKey: ['job-budgets', jobId],
    queryFn: async () => (await supabase.from('job_hour_budgets').select('budget_role_id, hours').eq('job_id', jobId)).data ?? [],
  })
  const logged = useQuery({
    queryKey: ['job-hours', jobId],
    queryFn: async () => (await supabase.from('job_hours_vs_budget').select('*').eq('job_id', jobId)).data ?? [],
  })
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const action = useAction()
  const mayEdit = canWrite(role) && (role === 'owner' || role === 'project_lead')
  const budgetOf = (id: string) => budgets.data?.find((b) => b.budget_role_id === id)?.hours
  const loggedOf = (id: string) => logged.data?.find((l) => l.budget_role_id === id)

  const save = () => action.run(async () => {
    for (const r of roles.data ?? []) {
      const raw = draft?.[r.id]?.trim() ?? ''
      const had = budgetOf(r.id)
      if (raw === '') {
        if (had !== undefined) {
          const { error } = await supabase.from('job_hour_budgets').delete().eq('job_id', jobId).eq('budget_role_id', r.id)
          if (error) return friendlyError(error)
        }
        continue
      }
      const hours = Number(raw)
      if (!Number.isFinite(hours) || hours < 0) return `${r.name}: enter hours as a number.`
      if (had !== undefined && Number(had) === hours) continue
      const { error } = await supabase.from('job_hour_budgets').upsert({ job_id: jobId, budget_role_id: r.id, hours }, { onConflict: 'job_id,budget_role_id' })
      if (error) return friendlyError(error)
    }
    setDraft(null)
    for (const k of ['job-budgets', 'job-hours']) await qc.invalidateQueries({ queryKey: [k, jobId] })
  })

  const rows = (roles.data ?? []).filter((r) => draft || budgetOf(r.id) !== undefined || loggedOf(r.id))
  const sum = (f: (id: string) => number) => rows.reduce((s, r) => s + f(r.id), 0)

  return (
    <>
      <p className="muted small">Hours roll up by the budget role of the person who logged them. Entered by hand in Phase A; created from the quote in Phase B.</p>
      {rows.length === 0 && !draft ? <p className="empty">No hours budget yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Role</th><th className="num">Budget</th><th className="num">Logged</th><th className="num">Approved</th><th className="num">Left</th></tr></thead>
          <tbody>{rows.map((r) => {
            const b = budgetOf(r.id); const l = loggedOf(r.id)
            const over = l?.over_budget
            return (
              <tr key={r.id} className={over ? 'row-bad' : undefined}>
                <td>{r.name}{over && <span className="warn-text small"> over budget</span>}</td>
                <td className="num">{draft
                  ? <input value={draft[r.id] ?? ''} inputMode="decimal" onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} style={{ width: '6rem', textAlign: 'right' }} aria-label={`${r.name} hours`} />
                  : b === undefined ? '—' : Number(b)}</td>
                <td className="num">{Number(l?.logged_hours ?? 0)}</td>
                <td className="num">{Number(l?.approved_hours ?? 0)}</td>
                <td className="num">{b === undefined ? '—' : Number(b) - Number(l?.logged_hours ?? 0)}</td>
              </tr>
            )
          })}
          <tr className="total-row"><td>Total</td><td className="num">{sum((id) => Number(budgetOf(id) ?? 0))}</td>
            <td className="num">{sum((id) => Number(loggedOf(id)?.logged_hours ?? 0))}</td><td className="num">{sum((id) => Number(loggedOf(id)?.approved_hours ?? 0))}</td><td /></tr>
          </tbody>
        </table></div>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
      {mayEdit && (
        <div className="form-actions">
          {draft
            ? <><button className="primary" disabled={action.busy} onClick={save}>Save budget</button><button onClick={() => setDraft(null)}>Cancel</button></>
            : <button onClick={() => setDraft(Object.fromEntries((roles.data ?? []).map((r) => [r.id, budgetOf(r.id) === undefined ? '' : String(Number(budgetOf(r.id)))])))}>Edit budget</button>}
        </div>
      )}
    </>
  )
}

function Milestones({ job: j }: { job: Job }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const action = useAction()
  const list = useQuery({
    queryKey: ['job-milestones', j.id],
    queryFn: async () => (await supabase.from('billing_milestones').select('*').eq('job_id', j.id).order('seq')).data ?? [],
  })
  const refresh = async () => { for (const k of ['job-milestones', 'job-money']) await qc.invalidateQueries({ queryKey: [k, j.id] }) }
  const writer = canWrite(role) && R.billingMilestones.createRoles.includes(role!)
  const marker = canWrite(role) && (role === 'owner' || role === 'project_lead')
  const total = (list.data ?? []).reduce((s, m) => s + Number(m.amount ?? 0), 0)
  const diff = Number(j.fee ?? 0) - total

  if (j.contract_mode === 'design_build') {
    return <p className="empty">Design-and-build jobs are billed by valuation, which arrives in Phase B.</p>
  }
  const setStatus = (id: string, status: 'reached' | 'pending') => action.run(async () => {
    const { error } = await supabase.from('billing_milestones').update({ status }).eq('id', id)
    if (error) return friendlyError(error)
    await refresh()
  })

  return (
    <>
      {(list.data ?? []).length > 0 && Math.abs(diff) > 0.005 && (
        <p className="warn-text small">The milestones add up to {formatMoney(total)}, which is {formatMoney(Math.abs(diff))} {diff > 0 ? 'less' : 'more'} than the fee of {formatMoney(j.fee)}.</p>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
      {(list.data ?? []).length === 0 ? <p className="empty">No billing milestones yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Milestone</th><th className="num">Amount</th><th>Target</th><th>Status</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map((m) => (
            <tr key={m.id}>
              <td>{m.seq}</td>
              <td>{m.name}{m.percent_of_fee && <span className="muted small"> ({Number(m.percent_of_fee)}% of fee)</span>}
                {m.trigger_description && <div className="muted small">{m.trigger_description}</div>}</td>
              <td><Money value={m.amount} /></td>
              <td>{formatDate(m.target_date)}{m.status === 'pending' && m.target_date && m.target_date < todayAccra() && <div className="warn-text small">past target</div>}</td>
              <td><StatusBadge status={m.status === 'reached' ? 'approved' : m.status} label={m.status} />
                {m.reached_on && <div className="muted small">reached {formatDate(m.reached_on)}</div>}</td>
              <td className="row-actions">
                {marker && m.status === 'pending' && <button disabled={action.busy} onClick={() => setStatus(m.id, 'reached')}>Mark reached</button>}
                {marker && m.status === 'reached' && <button className="link" disabled={action.busy} onClick={() => setStatus(m.id, 'pending')}>Back to pending</button>}
                {m.status === 'reached' && role !== 'project_lead' && <Link to="/invoices/ready">Invoice it</Link>}
                {writer && ['pending', 'reached'].includes(m.status) && <button className="link" onClick={() => setEditing(m as unknown as Row)}>Edit</button>}
              </td>
            </tr>
          ))}
          <tr className="total-row"><td /><td>Total (fee {formatMoney(j.fee)})</td><td><Money value={total} /></td><td colSpan={3} /></tr>
          </tbody>
        </table></div>
      )}
      {writer && <div className="form-actions"><button className="primary" onClick={() => setEditing('new')}>+ Add milestone</button></div>}
      {editing && (
        <Dialog title={editing === 'new' ? 'New milestone' : 'Milestone'} onClose={() => setEditing(null)}>
          <ResourceForm resource={R.billingMilestones} row={editing === 'new' ? null : editing} hide={['job_id', 'status']}
            preset={{ job_id: j.id, seq: (list.data?.length ?? 0) + 1 }}
            onDone={async () => { setEditing(null); await refresh() }} />
        </Dialog>
      )}
    </>
  )
}

function JobInvoices({ jobId }: { jobId: string }) {
  const list = useQuery({
    queryKey: ['job-invoices', jobId],
    queryFn: async () => (await supabase.from('invoices')
      .select('id, invoice_number, draft_ref, invoice_date, due_date, status, gross_total, retention_amount, outstanding')
      .eq('job_id', jobId).order('invoice_date', { ascending: false })).data ?? [],
  })
  if ((list.data ?? []).length === 0) return <p className="empty">No invoices for this job yet. <Link to="/invoices">Draft one</Link>.</p>
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="num">Gross</th><th className="num">Retention</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
      <tbody>{(list.data ?? []).map((i) => (
        <tr key={i.id}>
          <td><Link to={`/invoices/${i.invoice_number ?? i.draft_ref}`}>{i.invoice_number ?? i.draft_ref}</Link></td>
          <td>{formatDate(i.invoice_date)}</td><td>{formatDate(i.due_date)}</td>
          <td><Money value={i.gross_total} /></td><td><Money value={i.retention_amount} /></td><td><Money value={i.outstanding} /></td>
          <td><StatusBadge status={i.status} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

function Contracts({ jobId }: { jobId: string }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const list = useQuery({
    queryKey: ['job-contracts', jobId],
    queryFn: async () => (await db.from('job_contracts').select('*').eq('job_id', jobId).order('doc_date', { ascending: false })).data ?? [],
  })
  const writer = canWrite(role) && R.jobContracts.createRoles.includes(role!)
  const docType = (v: unknown) => R.jobContracts.fields.find((f) => f.name === 'doc_type')!.options!.find((o) => o.value === v)?.label ?? String(v)
  return (
    <>
      {(list.data ?? []).length === 0 ? <p className="empty">No contract documents recorded yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Document</th><th>Date</th><th>Parties</th><th className="num">Value</th><th>Key terms</th></tr></thead>
          <tbody>{(list.data as Row[]).map((c) => (
            <tr key={String(c.id)} className="clickable" onClick={() => setEditing(c)}>
              <td>{docType(c.doc_type)}</td><td>{formatDate(c.doc_date as string)}</td><td>{String(c.parties ?? '—')}</td>
              <td><Money value={c.value as number} /></td>
              <td className="small">{[c.payment_terms && `Payment: ${c.payment_terms}`, c.retention_terms && `Retention: ${c.retention_terms}`,
                c.liability_cap && `Liability cap: ${c.liability_cap}`].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted small">Attaching the signed files comes with document storage.</p>
      {writer && <div className="form-actions"><button className="primary" onClick={() => setEditing('new')}>+ Add document</button></div>}
      {editing && (
        <Dialog title={editing === 'new' ? 'New contract document' : 'Contract document'} onClose={() => setEditing(null)}>
          <ResourceForm resource={R.jobContracts} row={editing === 'new' ? null : editing} hide={['job_id']} preset={{ job_id: jobId }}
            onDone={async () => { setEditing(null); await qc.invalidateQueries({ queryKey: ['job-contracts', jobId] }) }} />
        </Dialog>
      )}
    </>
  )
}
