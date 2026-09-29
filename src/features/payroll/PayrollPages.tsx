import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { Money, StatusBadge, useAction } from '../../components/ui'
import { formatDate, formatMoney, parseMoney, todayAccra } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import { lookups } from '../../resources/lookups'
import { fetchLookupRows, friendlyError } from '../../resources/useLookups'
import {
  addTotals, DEFAULT_STAFF_MAP, FIELD_LABELS, matchStaff, PAYROLL_FIELDS, parsePayrollCsv,
  type ColumnMap, type PayrollField, type SheetLine, type SheetResult,
} from './parse'

const monthKey = (d: string) => d.slice(0, 7)          // 2026-05-01 -> 2026-05
const monthLabel = (d: string) => formatDate(d.length === 7 ? `${d}-01` : d).replace(/^\d+ /, '')
const monthStart = (key: string) => `${key}-01`

async function loadMaps(): Promise<Record<'staff' | 'nsp', ColumnMap & { saved: boolean }>> {
  const { data } = await supabase.from('payroll_column_maps').select('*').lte('effective_from', todayAccra()).order('effective_from', { ascending: false })
  const pick = (kind: 'staff' | 'nsp') => {
    const row = data?.find((r) => r.sheet_kind === kind)
    if (!row) return { ...DEFAULT_STAFF_MAP, saved: false }
    const m = row.mapping as unknown as Omit<ColumnMap, 'header_row'>
    return { header_row: row.header_row, name: m.name, fields: m.fields, saved: true }
  }
  return { staff: pick('staff'), nsp: pick('nsp') }
}

// ---------------------------------------------------------------------------
// /payroll
// ---------------------------------------------------------------------------
export function PayrollPage() {
  const { role } = useAuth()
  const runs = useQuery({
    queryKey: ['payroll_runs'],
    queryFn: async () => (await supabase.from('payroll_runs').select('*, lines:payroll_lines(gross, net_pay, bank_amount, full_cost_to_company)')
      .order('period_month', { ascending: false }).order('created_at', { ascending: false })).data ?? [],
  })
  const [importing, setImporting] = useState(false)
  const [mapping, setMapping] = useState(false)
  const writer = canWrite(role) && (role === 'owner' || role === 'accountant')
  return (
    <section>
      <header className="page-header">
        <div><h1>Payroll</h1><p className="muted">Payroll is calculated in the spreadsheet; the system imports it, checks it, and issues payslips (brief §7.5).</p></div>
        <div className="actions">
          {writer && <button className="primary" onClick={() => setImporting(true)}>Import a month</button>}
          {writer && <button onClick={() => setMapping(true)}>Column map</button>}
        </div>
      </header>
      {(runs.data ?? []).length === 0 ? <p className="empty">No payroll runs yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Month</th><th>Run</th><th>People</th><th className="num">Gross</th><th className="num">Bank amounts</th><th className="num">Cost to company</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>{runs.data!.map((r) => {
            const sum = (k: 'gross' | 'bank_amount' | 'full_cost_to_company') => (r.lines ?? []).reduce((s, l) => s + Number(l[k]), 0)
            return (
              <tr key={r.id}>
                <td><Link to={`/payroll/${monthKey(r.period_month)}${r.run_kind === 'supplementary' ? `?run=${r.id}` : ''}`}>{monthLabel(r.period_month)}</Link></td>
                <td>{r.run_kind}</td><td>{(r.lines ?? []).length}</td>
                <td><Money value={sum('gross')} /></td><td><Money value={sum('bank_amount')} /></td><td><Money value={sum('full_cost_to_company')} /></td>
                <td>{formatDate(r.paid_date)}</td><td><StatusBadge status={r.status} /></td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
      {importing && <ImportWizard onClose={() => setImporting(false)} />}
      {mapping && <ColumnMapEditor onClose={() => setMapping(false)} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Import: staff sheet + NSP sheet into one run (D-022)
// ---------------------------------------------------------------------------
interface PreviewLine extends SheetLine { sheet: 'staff' | 'nsp'; staffId: string }

function ImportWizard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const maps = useQuery({ queryKey: ['payroll-maps'], queryFn: loadMaps })
  const staff = useQuery({ queryKey: ['staff-all'], queryFn: async () => (await supabase.from('staff').select('id, full_name, is_active').order('full_name')).data ?? [] })
  const lastMonth = (() => { const d = new Date(todayAccra()); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })()
  const [month, setMonth] = useState(lastMonth)
  const [kind, setKind] = useState<'regular' | 'supplementary'>('regular')
  const [files, setFiles] = useState<{ staff?: File; nsp?: File }>({})
  const [results, setResults] = useState<{ staff?: SheetResult; nsp?: SheetResult }>({})
  const [lines, setLines] = useState<PreviewLine[]>([])
  const action = useAction()

  async function read(which: 'staff' | 'nsp', file: File | undefined) {
    const next = { ...files, [which]: file }
    setFiles(next)
    if (!maps.data || !staff.data) return
    const res: typeof results = {}
    const all: PreviewLine[] = []
    for (const k of ['staff', 'nsp'] as const) {
      const f = next[k]
      if (!f) continue
      const r = parsePayrollCsv(await f.text(), maps.data[k])
      res[k] = r
      for (const l of r.lines) all.push({ ...l, sheet: k, staffId: matchStaff(l.name, staff.data)?.id ?? '' })
    }
    setResults(res); setLines(all)
  }

  const errors = [...(results.staff?.errors ?? []).map((e) => `Staff sheet: ${e}`), ...(results.nsp?.errors ?? []).map((e) => `NSP sheet: ${e}`)]
  const unmatched = lines.filter((l) => !l.staffId)
  const dupes = lines.filter((l, i) => l.staffId && lines.findIndex((x) => x.staffId === l.staffId) !== i)

  function create() {
    action.run(async () => {
      if (unmatched.length) return 'Match every row to a staff member first'
      if (dupes.length) return 'Two rows are matched to the same person'
      const totals = addTotals(results.staff?.totals ?? null, results.nsp?.totals ?? null)
      const { data: run, error } = await db.from('payroll_runs').insert({
        period_month: monthStart(month), run_kind: kind,
        source_files: [files.staff?.name, files.nsp?.name].filter(Boolean), sheet_totals: totals ?? {},
      }).select('id').single()
      if (error) return friendlyError(error)
      const rows = lines.map((l) => ({
        run_id: run.id, staff_id: l.staffId, source: 'import', sheet_kind: l.sheet,
        ...Object.fromEntries(PAYROLL_FIELDS.map((f) => [f, l.values[f]])),
        taxable_allowance_detail: l.taxableDetail, post_tax_allowance_detail: l.postTaxDetail,
      }))
      const { error: e2 } = await db.from('payroll_lines').insert(rows)
      if (e2) {
        await supabase.from('payroll_runs').delete().eq('id', run.id)
        return friendlyError(e2)
      }
      await qc.invalidateQueries({ queryKey: ['payroll_runs'] })
      navigate(`/payroll/${month}${kind === 'supplementary' ? `?run=${run.id}` : ''}`)
    })
  }

  return (
    <Dialog title="Import payroll" onClose={onClose}>
      <p className="muted">In Excel, save each payroll sheet as <strong>CSV</strong> (File → Save As → CSV). Upload the staff sheet and, if national service persons are on a separate sheet, that one too: both go into one run.</p>
      <div className="form-grid">
        <label>Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <label>Run<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="regular">Regular monthly run</option><option value="supplementary">Supplementary (a correction)</option></select></label>
        <label>Staff sheet (CSV)<input type="file" accept=".csv,text/csv" onChange={(e) => read('staff', e.target.files?.[0])} /></label>
        <label>National service sheet (CSV, optional)<input type="file" accept=".csv,text/csv" onChange={(e) => read('nsp', e.target.files?.[0])} /></label>
      </div>
      {maps.data && !maps.data.nsp.saved && files.nsp && <p className="warn-text small">The NSP sheet uses the staff sheet's column map until an NSP map is saved (Column map).</p>}
      {errors.map((e) => <p key={e} className="form-error">{e}</p>)}
      {lines.length > 0 && (
        <>
          <h3>{lines.length} people found</h3>
          <div className="table-wrap"><table className="compact">
            <thead><tr><th>Sheet row</th><th>Name on sheet</th><th>Staff member</th><th className="num">Gross</th><th className="num">Net</th><th className="num">Bank</th></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={`${l.sheet}-${l.row}`} className={!l.staffId ? 'row-bad' : undefined}>
                <td>{l.sheet === 'nsp' ? 'NSP ' : ''}{l.row}</td><td>{l.name}</td>
                <td><select value={l.staffId} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, staffId: e.target.value } : x))}>
                  <option value="">Match to…</option>
                  {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.is_active ? '' : ' (inactive)'}</option>)}
                </select></td>
                <td><Money value={l.values.gross} /></td><td><Money value={l.values.net_pay} /></td><td><Money value={l.values.bank_amount} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="muted small">The run is checked in full after import (everyone present, net and bank amounts, sheet totals, loan instalments) before the Owner can approve it.</p>
        </>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
      <div className="form-actions">
        <button className="primary" disabled={action.busy || lines.length === 0 || errors.some((e) => e.includes('not a number'))} onClick={create}>Create the run</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  )
}

function ColumnMapEditor({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const maps = useQuery({ queryKey: ['payroll-maps'], queryFn: loadMaps })
  const [kind, setKind] = useState<'staff' | 'nsp'>('staff')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const action = useAction()
  const current = maps.data?.[kind]
  const asText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join('+') : v ?? '')
  const value = (k: string) => draft[`${kind}.${k}`] ?? (k === 'header_row' ? String(current?.header_row ?? '') : k === 'name' ? current?.name ?? '' : asText(current?.fields[k as PayrollField]))
  const set = (k: string, v: string) => setDraft({ ...draft, [`${kind}.${k}`]: v })

  function save(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const fields: ColumnMap['fields'] = {}
      for (const f of PAYROLL_FIELDS) {
        const letters = value(f).split(/[+,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)
        if (letters.some((l) => !/^[A-Z]{1,3}$/.test(l))) return `${FIELD_LABELS[f]}: use column letters like D or E+F+G`
        if (letters.length) fields[f] = letters.length === 1 ? letters[0] : letters
      }
      const header = Number(value('header_row'))
      if (!Number.isInteger(header) || header < 1) return 'Heading row must be a row number'
      if (!/^[A-Z]{1,3}$/i.test(value('name'))) return 'Name column must be a letter'
      const { error } = await supabase.from('payroll_column_maps').upsert({
        sheet_kind: kind, effective_from: todayAccra(), sheet_name: kind === 'staff' ? 'Staff' : 'NSP', header_row: header, first_data_row: header + 1,
        mapping: { name: value('name').toUpperCase(), fields } as never,
      }, { onConflict: 'sheet_kind,effective_from' })
      if (error) return friendlyError(error)
      await qc.invalidateQueries({ queryKey: ['payroll-maps'] })
      onClose()
    })
  }

  return (
    <Dialog title="Payroll column map" onClose={onClose}>
      <p className="muted">Which spreadsheet column holds each figure. Several columns can be added up (e.g. E+F+G). Defaults follow the May 2026 "Staff" sheet.</p>
      <div className="tabs">
        <button aria-selected={kind === 'staff'} onClick={() => setKind('staff')}>Staff sheet</button>
        <button aria-selected={kind === 'nsp'} onClick={() => setKind('nsp')}>National service sheet</button>
      </div>
      {current && !current.saved && <p className="warn-text small">Not saved yet: showing the defaults.</p>}
      <form onSubmit={save}>
        <div className="form-grid">
          <label>Heading row<input value={value('header_row')} onChange={(e) => set('header_row', e.target.value)} /></label>
          <label>Name column<input value={value('name')} onChange={(e) => set('name', e.target.value)} /></label>
          {PAYROLL_FIELDS.map((f) => <label key={f}>{FIELD_LABELS[f]}<input value={value(f)} onChange={(e) => set(f, e.target.value)} placeholder="—" /></label>)}
        </div>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Save map</button></div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// /payroll/:month
// ---------------------------------------------------------------------------
export function PayrollRunPage() {
  const { month = '' } = useParams()
  const { role } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const runId = new URLSearchParams(window.location.search).get('run')
  const run = useQuery({
    queryKey: ['payroll_run', month, runId],
    queryFn: async () => {
      let q = supabase.from('payroll_runs').select('*').eq('period_month', monthStart(month)).neq('status', 'cancelled')
      q = runId ? q.eq('id', runId) : q.eq('run_kind', 'regular')
      return (await q.maybeSingle()).data
    },
  })
  const r = run.data
  const lines = useQuery({ queryKey: ['payroll_lines', r?.id], enabled: !!r, queryFn: async () =>
    (await supabase.from('payroll_lines').select('*, staff:staff(full_name)').eq('run_id', r!.id)).data ?? [] })
  const checks = useQuery({ queryKey: ['payroll_checks', r?.id], enabled: !!r, queryFn: async () =>
    (await supabase.rpc('payroll_checks', { p_run: r!.id })).data ?? [] })
  const costChanges = useQuery({ queryKey: ['payroll_cost_changes', r?.id], enabled: !!r && role === 'owner' && r.status !== 'imported', queryFn: async () =>
    (await supabase.from('payroll_cost_changes').select('*').eq('run_id', r!.id)).data ?? [] })
  const action = useAction()
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState(false)
  const sorted = useMemo(() => [...(lines.data ?? [])].sort((a, b) => (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? '')), [lines.data])

  if (run.isLoading) return <p className="muted">Loading…</p>
  if (!r) return <section className="notice"><h1>No payroll for {monthLabel(month)}</h1><Link to="/payroll">All payroll runs</Link></section>

  const writer = canWrite(role) && (role === 'owner' || role === 'accountant')
  const blocking = (checks.data ?? []).filter((c) => c.severity === 'blocking')
  const warnings = (checks.data ?? []).filter((c) => c.severity === 'warning')
  const refresh = async () => { for (const k of ['payroll_run', 'payroll_lines', 'payroll_checks', 'payroll_runs', 'payroll_cost_changes']) await qc.invalidateQueries({ queryKey: [k] }) }
  const setRun = (patch: Record<string, unknown>) => action.run(async () => {
    const { error } = await db.from('payroll_runs').update(patch).eq('id', r.id)
    if (error) return friendlyError(error)
    await refresh()
  })
  const total = (k: string) => sorted.reduce((s, l) => s + Number((l as Record<string, unknown>)[k] ?? 0), 0)

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="muted small"><Link to="/payroll">Payroll</Link></p>
          <h1>{monthLabel(month)} {r.run_kind === 'supplementary' && '(supplementary)'} <StatusBadge status={r.status} /></h1>
          <p className="muted small">{(r.source_files as string[] | null)?.join(', ')}{r.approved_at && ` · approved ${formatDate(r.approved_at)}`}{r.paid_date && ` · paid ${formatDate(r.paid_date)}`}{r.issued_at && ` · payslips issued ${formatDate(r.issued_at)}`}</p>
        </div>
        <div className="actions">
          {r.status === 'imported' && role === 'owner' && <button className="primary" disabled={action.busy || blocking.length > 0} onClick={() => setRun({ status: 'approved' })}>Approve</button>}
          {writer && r.status !== 'imported' && !r.paid_date && <button onClick={() => setPaying(true)}>Record net pay as paid</button>}
          {writer && r.status === 'approved' && <button className="primary" disabled={action.busy} onClick={() => setRun({ status: 'issued' })}>Issue payslips</button>}
          {writer && r.status === 'imported' && <button onClick={() => setAdding(true)}>Add a person manually</button>}
          {writer && r.status === 'imported' && <button className="link" onClick={() => action.run(async () => {
            if (!confirm('Delete this imported run?')) return
            const { error } = await supabase.from('payroll_runs').delete().eq('id', r.id)
            if (error) return friendlyError(error)
            await qc.invalidateQueries({ queryKey: ['payroll_runs'] }); navigate('/payroll')
          })}>Delete run</button>}
        </div>
      </header>
      {action.error && <p className="form-error">{action.error}</p>}

      {r.status === 'imported' && (
        <div className="panel">
          <h3>Checks before approval</h3>
          {blocking.length === 0 ? <p className="form-ok">Every check passes{warnings.length ? '; see the notes below' : ''}.</p> : (
            <ul className="checks">{blocking.map((c, i) => <li key={i} className="bad"><strong>{c.staff_name ?? 'Run'}:</strong> {c.message}</li>)}</ul>
          )}
          {warnings.length > 0 && <ul className="checks">{warnings.map((c, i) => <li key={i}><strong>{c.staff_name}:</strong> {c.message}</li>)}</ul>}
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: '1rem' }}><table>
        <thead><tr><th>Person</th><th className="num">Basic</th><th className="num">Gross</th><th className="num">SSF (emp.)</th><th className="num">PAYE</th><th className="num">After-tax allow.</th>
          <th className="num">Net</th><th className="num">Loan</th><th className="num">Bank</th><th className="num">Cost to company</th>{writer && r.status === 'imported' && <th />}</tr></thead>
        <tbody>
          {sorted.map((l) => (
            <tr key={l.id}>
              <td>{l.staff?.full_name}{l.source === 'manual' && <span className="muted small"> (manual)</span>}{l.is_national_service && <div className="muted small">allowance statement</div>}</td>
              <td><Money value={l.basic} /></td><td><Money value={l.gross} /></td><td><Money value={l.ssnit_employee} /></td><td><Money value={l.paye} /></td>
              <td><Money value={l.post_tax_allowances} /></td><td><Money value={l.net_pay} /></td><td><Money value={l.loan_deduction} /></td>
              <td><Money value={l.bank_amount} /></td><td><Money value={l.full_cost_to_company} /></td>
              {writer && r.status === 'imported' && <td><button className="link" onClick={() => action.run(async () => {
                const { error } = await supabase.from('payroll_lines').delete().eq('id', l.id)
                if (error) return friendlyError(error)
                await refresh()
              })}>Remove</button></td>}
            </tr>
          ))}
          <tr className="total-row"><td>Total</td><td><Money value={total('basic')} /></td><td><Money value={total('gross')} /></td><td><Money value={total('ssnit_employee')} /></td>
            <td><Money value={total('paye')} /></td><td><Money value={total('post_tax_allowances')} /></td><td><Money value={total('net_pay')} /></td>
            <td><Money value={total('loan_deduction')} /></td><td><Money value={total('bank_amount')} /></td><td><Money value={total('full_cost_to_company')} /></td>{writer && r.status === 'imported' && <td />}</tr>
        </tbody>
      </table></div>

      {role === 'owner' && (costChanges.data ?? []).length > 0 && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Staff costs that changed</h3>
          <p className="muted small">Confirm to add a new dated row to the cost history (never overwritten; frozen timesheet rates don't change).</p>
          <table className="compact"><thead><tr><th>Person</th><th className="num">Current cost</th><th className="num">This payroll</th></tr></thead>
            <tbody>{costChanges.data!.map((c) => <tr key={c.staff_id!}><td>{c.full_name}</td><td><Money value={c.current_cost} /></td><td><Money value={c.payroll_cost} /></td></tr>)}</tbody></table>
          <div className="form-actions"><button className="primary" disabled={action.busy} onClick={() => action.run(async () => {
            const { error } = await supabase.rpc('apply_payroll_cost_changes', { p_run: r.id, p_staff: costChanges.data!.map((c) => c.staff_id!) })
            if (error) return friendlyError(error)
            await refresh()
          })}>Update the cost history</button></div>
        </div>
      )}
      {adding && <ManualLine runId={r.id} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await refresh() }} />}
      {paying && <RecordPaid runId={r.id} onClose={() => setPaying(false)} onSaved={async () => { setPaying(false); await refresh() }} />}
    </section>
  )
}

function ManualLine({ runId, onClose, onSaved }: { runId: string; onClose: () => void; onSaved: () => void }) {
  const staff = useQuery({ queryKey: ['staff-all'], queryFn: async () => (await supabase.from('staff').select('id, full_name, is_active').order('full_name')).data ?? [] })
  const [staffId, setStaffId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const action = useAction()
  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const row: Record<string, unknown> = { run_id: runId, staff_id: staffId, source: 'manual' }
      for (const f of PAYROLL_FIELDS) {
        const v = values[f]?.trim() ? parseMoney(values[f]) : 0
        if (v === null) return `${FIELD_LABELS[f]}: not a number`
        row[f] = v
      }
      const { error } = await db.from('payroll_lines').insert(row)
      if (error) return friendlyError(error)
      onSaved()
    })
  }
  return (
    <Dialog title="Add a person to this run" onClose={onClose}>
      <p className="muted">Manual lines get exactly the same checks as imported ones (D-022).</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Staff member<select value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
            <option value="">Choose…</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>
          {PAYROLL_FIELDS.map((f) => <label key={f}>{FIELD_LABELS[f]}<input inputMode="decimal" value={values[f] ?? ''} onChange={(e) => setValues({ ...values, [f]: e.target.value })} placeholder="0.00" /></label>)}
        </div>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Add</button></div>
      </form>
    </Dialog>
  )
}

function RecordPaid({ runId, onClose, onSaved }: { runId: string; onClose: () => void; onSaved: () => void }) {
  const accounts = useQuery({ queryKey: ['lookup', 'account_picker'], queryFn: () => fetchLookupRows(lookups.account) })
  const [date, setDate] = useState(todayAccra())
  const [account, setAccount] = useState('')
  const action = useAction()
  return (
    <Dialog title="Record net pay as paid" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); action.run(async () => {
        const { error } = await supabase.from('payroll_runs').update({ paid_date: date, account_id: account }).eq('id', runId)
        if (error) return friendlyError(error)
        onSaved()
      }) }}>
        <p className="muted">The bank amounts leave this account on this date (A-012). Loan deductions were recorded as repayments when the run was approved.</p>
        <label>Date paid<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Account<select value={account} onChange={(e) => setAccount(e.target.value)} required>
          <option value="">Choose…</option>{(accounts.data ?? []).map((a) => <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}</select></label>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Record as paid</button></div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Payslips: /me/payslips and /me/payslips/:id
// ---------------------------------------------------------------------------
export function MyPayslips() {
  const { role } = useAuth()
  const slips = useQuery({ queryKey: ['payslips'], queryFn: async () =>
    (await supabase.from('payslips').select('id, period_month, is_allowance_statement, issued_at, staff:staff(full_name)').order('period_month', { ascending: false })).data ?? [] })
  const finance = role === 'owner' || role === 'director' || role === 'accountant'
  return (
    <section className="narrow">
      <h1>{finance ? 'Payslips' : 'My payslips'}</h1>
      {(slips.data ?? []).length === 0 ? <p className="empty">No payslips yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Month</th>{finance && <th>Person</th>}<th>Type</th><th>Issued</th></tr></thead>
          <tbody>{slips.data!.map((s) => (
            <tr key={s.id}><td><Link to={`/me/payslips/${s.id}`}>{monthLabel(s.period_month)}</Link></td>{finance && <td>{s.staff?.full_name}</td>}
              <td>{s.is_allowance_statement ? 'Allowance statement' : 'Payslip'}</td><td>{formatDate(s.issued_at)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  )
}

export function PayslipView() {
  const { id = '' } = useParams()
  const slip = useQuery({ queryKey: ['payslip', id], queryFn: async () =>
    (await supabase.from('payslips').select('*, line:payroll_lines(*), staff:staff(full_name, job_title)').eq('id', id).maybeSingle()).data })
  const priv = useQuery({ queryKey: ['staff_private', slip.data?.staff_id], enabled: !!slip.data, queryFn: async () =>
    (await supabase.from('staff_private').select('ssnit_number, tin').eq('staff_id', slip.data!.staff_id).maybeSingle()).data })
  const co = useQuery({ queryKey: ['company-profile'], queryFn: async () => (await supabase.from('company_profile').select('*').maybeSingle()).data })
  if (slip.isLoading) return <p className="muted">Loading…</p>
  const s = slip.data
  if (!s || !s.line) return <section className="notice"><h1>No access</h1><p>This payslip isn't yours, or it doesn't exist.</p><Link to="/me/payslips">My payslips</Link></section>
  const l = s.line
  const ytd = (s.ytd ?? {}) as Record<string, number>
  const row = (label: string, v: number | null | undefined) => Number(v) ? <tr><td>{label}</td><td className="num">{formatMoney(v, false)}</td></tr> : null
  const detail = (d: unknown) => Object.entries((d ?? {}) as Record<string, number>).map(([k, v]) => row(k, v))
  return (
    <div className="print-overlay" style={{ position: 'static', background: 'none', padding: 0 }}>
      <div className="print-toolbar no-print"><button className="primary" onClick={() => window.print()}>Print / Save as PDF</button><Link to="/me/payslips">Back</Link></div>
      <article className="print-sheet" style={{ minHeight: 0 }}>
        <header className="letterhead">
          <img src="/brand/melins-logo.jpg" alt="MeLiNS" />
          <div><strong>{co.data?.registered_name ?? 'MeLiNS Associates Limited'}</strong><div className="small">{co.data?.address}</div>
            <div className="tagline">STRUCTURES · CIVILS · DEVELOPMENT CONSULTANTS</div></div>
        </header>
        <h1 className="doc-title">{s.is_allowance_statement ? 'ALLOWANCE STATEMENT' : 'PAYSLIP'}: {monthLabel(s.period_month).toUpperCase()}</h1>
        <p><strong>{s.staff?.full_name}</strong> · {s.staff?.job_title}{priv.data?.ssnit_number && ` · SSNIT ${priv.data.ssnit_number}`}{priv.data?.tin && ` · TIN ${priv.data.tin}`}</p>
        <div className="detail-grid">
          <table className="totals"><tbody>
            <tr><td colSpan={2}><strong>Pay</strong></td></tr>
            {row(s.is_allowance_statement ? 'Allowance' : 'Basic', l.basic)}
            {detail(l.taxable_allowance_detail)}
            {row('Bonus', l.bonus)}
            <tr className="grand"><td>Gross</td><td className="num">{formatMoney(l.gross, false)}</td></tr>
            {detail(l.post_tax_allowance_detail)}
          </tbody></table>
          <table className="totals"><tbody>
            <tr><td colSpan={2}><strong>Deductions</strong></td></tr>
            {row('SSNIT (employee 5.5%)', l.ssnit_employee)}
            {row('Provident fund (employee)', l.pf_employee)}
            {row('PAYE', l.paye)}
            {row('Bonus PAYE', l.bonus_paye)}
            {row('Loan repayment', l.loan_deduction)}
            {row('Advance recovery', l.advance_recovery)}
            {row('Other deductions', l.other_deductions)}
            <tr className="grand"><td>Paid to bank</td><td className="num">{formatMoney(l.bank_amount)}</td></tr>
          </tbody></table>
        </div>
        <table className="totals"><tbody>
          <tr><td colSpan={2}><strong>Employer contributions</strong> (not deducted from your pay)</td></tr>
          {row('SSNIT (employer 13%)', l.ssnit_employer)}
          {row('Provident fund (employer)', l.pf_employer)}
        </tbody></table>
        <h2 style={{ fontSize: '1rem' }}>Year to date</h2>
        <table className="totals"><tbody>
          {row('Gross', ytd.gross)}{row('PAYE', ytd.paye)}{row('SSNIT (employee)', ytd.ssnit_employee)}{row('Net pay', ytd.net_pay)}
        </tbody></table>
      </article>
    </div>
  )
}
