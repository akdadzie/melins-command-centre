// /settings (brief §5, §7.1, §10; A-044). Tabs by role:
//   Owner       Setup (the first-log-in wizard), Company and rules, Tax codes,
//               Statutory calendar, WHT rates, Users, Reference data
//   Accountant  Tax codes, Statutory calendar, WHT rates, Reference data;
//               Company and rules read-only
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { StatusBadge, useAction } from '../../components/ui'
import { formatDate, formatMoney, todayAccra } from '../../lib/format'
import { GO_LIVE_MONTH } from '../../lib/golive'
import { db, supabase } from '../../lib/supabase'
import * as R from '../../resources/definitions'
import { ResourceList } from '../../resources/ResourceList'
import type { ResourceDef } from '../../resources/types'
import { friendlyError } from '../../resources/useLookups'
import { ResourceTabs } from '../../pages/SimplePages'
import { UsersPanel } from '../../pages/UsersPanel'
import { fromInput, GROUPS, laterVersions, planSave, toInput, versionAt, type SettingsRow } from './settingsModel'

type Tab = 'setup' | 'company' | 'tax' | 'calendar' | 'wht' | 'users' | 'data'

const TAB_LABELS: Record<Tab, string> = {
  setup: 'Setup', company: 'Company and rules', tax: 'Tax codes', calendar: 'Statutory calendar',
  wht: 'WHT rates', users: 'Users', data: 'Reference data',
}

export function SettingsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const tabs: Tab[] = role === 'owner' ? ['setup', 'company', 'tax', 'calendar', 'wht', 'users', 'data'] : ['tax', 'calendar', 'wht', 'company', 'data']
  const requested = params.get('tab') as Tab | null
  const tab = requested && tabs.includes(requested) ? requested : tabs[0]
  const dataTabs = role === 'accountant'
    ? [R.publicHolidays, R.statutoryLines, R.accounts, R.expenseCategories]
    : [R.accounts, R.expenseCategories, R.jobTypes, R.timesheetActivities, R.leaveTypes, R.leaveEntitlements, R.publicHolidays]
  return (
    <section>
      <header className="page-header"><div><h1>Settings</h1>
        <p className="muted">Settings are dated: a change applies from its date, and earlier records keep the values in force when they were made.</p></div></header>
      <div className="tabs" role="tablist">
        {tabs.map((t) => <button key={t} role="tab" aria-selected={t === tab} onClick={() => setParams({ tab: t }, { replace: true })}>{TAB_LABELS[t]}</button>)}
      </div>
      {tab === 'setup' && <SetupWizard />}
      {tab === 'company' && <SettingsForm groups={GROUPS.map((g) => g.key)} />}
      {tab === 'tax' && <TaxCodesPanel />}
      {tab === 'calendar' && <StatutoryCalendarPanel />}
      {tab === 'wht' && <ResourceList resource={R.whtRates} />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'data' && <ResourceTabs tabs={dataTabs} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Dated settings form
// ---------------------------------------------------------------------------
function useSettingsVersions() {
  return useQuery({
    queryKey: ['settings-versions'],
    queryFn: async () => ((await supabase.from('settings_versions').select('*').order('effective_from')).data ?? []) as SettingsRow[],
  })
}

export function SettingsForm({ groups, defaultDate, onSaved }: { groups: string[]; defaultDate?: string; onSaved?: () => void }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const versions = useSettingsVersions()
  const [date, setDate] = useState(defaultDate ?? todayAccra())
  const [draft, setDraft] = useState<Record<string, string | boolean>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState<string | null>(null)
  const action = useAction()
  const editable = canWrite(role) && role === 'owner'
  const current = versionAt(versions.data ?? [], date)
  const later = laterVersions(versions.data ?? [], date)
  const shown = GROUPS.filter((g) => groups.includes(g.key))
  const fields = shown.flatMap((g) => g.fields)
  const value = (name: string) => (name in draft ? draft[name] : toInput(fields.find((f) => f.name === name)!, current?.[name as keyof SettingsRow]))

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaved(null)
    const changes: Record<string, unknown> = {}
    const errs: string[] = []
    for (const f of fields) {
      if (!(f.name in draft)) continue
      const r = fromInput(f, draft[f.name])
      if (!r.ok) errs.push(r.error)
      else if (r.value !== (current?.[f.name] ?? null)) changes[f.name] = r.value
    }
    setErrors(errs)
    if (errs.length) return
    if (!Object.keys(changes).length) { setSaved('Nothing changed.'); return }
    await action.run(async () => {
      const plan = planSave(versions.data ?? [], date, changes as Partial<SettingsRow>)
      const { error } = plan.mode === 'update'
        ? await db.from('settings_versions').update(plan.patch).eq('id', plan.id)
        : await db.from('settings_versions').insert(plan.row)
      if (error) return friendlyError(error)
      setDraft({})
      setSaved(plan.mode === 'update' ? `Saved to the settings in force from ${formatDate(date)}.` : `Saved as new settings from ${formatDate(date)}.`)
      for (const k of ['settings-versions', 'company-profile', 'money-panel']) await qc.invalidateQueries({ queryKey: [k] })
      onSaved?.()
    })
  }

  if (versions.isLoading) return <p className="muted">Loading…</p>
  return (
    <form className="stack narrow" onSubmit={save}>
      <div className="row-actions" style={{ alignItems: 'end' }}>
        <label>Effective from<input type="date" value={date} disabled={!editable} onChange={(e) => { setDate(e.target.value); setDraft({}) }} /></label>
        <p className="muted small" style={{ margin: 0 }}>Showing the settings in force on {formatDate(date)}
          {current && current.effective_from !== date && ` (set from ${formatDate(current.effective_from)})`}.</p>
      </div>
      {later.length > 0 && editable && <p className="warn-text small">Settings dated later ({later.map((v) => formatDate(v.effective_from)).join(', ')}) aren't changed by this; change them separately if needed.</p>}
      {shown.map((g) => (
        <fieldset key={g.key} className="panel">
          <legend><strong>{g.title}</strong> <span className="muted small">{g.who}</span></legend>
          <div className="form-grid">
            {g.fields.map((f) => {
              const v = value(f.name)
              const id = `s-${f.name}`
              const set = (x: string | boolean) => setDraft((d) => ({ ...d, [f.name]: x }))
              let input
              if (f.kind === 'boolean') input = <input id={id} type="checkbox" checked={Boolean(v)} disabled={!editable} onChange={(e) => set(e.target.checked)} />
              else if (f.kind === 'textarea') input = <textarea id={id} rows={3} value={String(v)} disabled={!editable} onChange={(e) => set(e.target.value)} />
              else if (f.kind === 'select' || f.kind === 'month') {
                const opts = f.kind === 'month' ? [...Array(12)].map((_, i) => [String(i + 1), new Date(Date.UTC(2026, i, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })]) : f.options!
                input = <select id={id} value={String(v)} disabled={!editable} onChange={(e) => set(e.target.value)}>
                  {!f.required && <option value="">—</option>}{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              } else input = <input id={id} value={String(v)} disabled={!editable} inputMode={f.kind === 'text' || f.kind === 'email' ? undefined : 'decimal'} onChange={(e) => set(e.target.value)} />
              return (
                <div key={f.name} className={`field field-${f.kind === 'textarea' ? 'textarea' : f.kind === 'boolean' ? 'boolean' : 'text'}`}>
                  <label htmlFor={id}>{f.label}{f.kind === 'percent' && <span className="unit"> %</span>}{f.kind === 'money' && <span className="unit"> GHS</span>}</label>
                  {input}
                  {f.help && <span className="help">{f.help}</span>}
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
      {errors.length > 0 && <div className="form-error"><ul className="checks">{errors.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {action.error && <p className="form-error">{action.error}</p>}
      {saved && <p className="form-ok">{saved}</p>}
      {editable && <div className="form-actions"><button className="primary" disabled={action.busy}>Save</button></div>}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Tax codes (D-018, D-019): dated versions with ordered components; never
// hardcoded. The Accountant confirms each version.
// ---------------------------------------------------------------------------
type Component = { seq: number; name: string; rate: string; basis: 'net' | 'net_plus_prior'; recoverable: boolean; is_vat: boolean }

export function TaxCodesPanel() {
  const { role, profile } = useAuth()
  const qc = useQueryClient()
  const action = useAction()
  const [adding, setAdding] = useState<{ id: string; name: string } | null>(null)
  const codes = useQuery({
    queryKey: ['tax-codes-full'],
    queryFn: async () => (await supabase.from('tax_codes')
      .select('id, name, kind, is_active, versions:tax_code_versions(id, effective_from, vat_withholding_rate, confirmed_at, notes, components:tax_code_components(seq, name, rate, basis, recoverable, is_vat))')
      .order('name')).data ?? [],
  })
  const writer = canWrite(role) && (role === 'owner' || role === 'accountant')
  const today = todayAccra()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tax-codes-full'] })

  return (
    <div className="stack">
      <p className="muted small">Enter current Ghana rates from GRA guidance, with the Accountant (brief §7.1). Each component is worked out on the net amount,
        or on the net plus the components before it. A rate change is a new version from its date: issued invoices keep the tax they were issued with.</p>
      {action.error && <p className="form-error">{action.error}</p>}
      {(codes.data ?? []).map((c) => {
        const versions = [...(c.versions ?? [])].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
        const inForce = versions.find((v) => v.effective_from <= today)
        return (
          <div key={c.id} className="panel">
            <div className="page-header" style={{ marginBottom: '.25rem' }}>
              <h3 style={{ margin: 0 }}>{c.name} <span className="muted small">{c.kind.replace('_', ' ')}</span>
                {!inForce && <span className="warn-text small"> · no rates in force</span>}</h3>
              {writer && <button onClick={() => setAdding({ id: c.id, name: c.name })}>Add rates from a date</button>}
            </div>
            {versions.length === 0 ? <p className="muted small">No versions yet.</p> : versions.map((v) => (
              <div key={v.id} className="small" style={{ marginTop: '.5rem' }}>
                <strong>From {formatDate(v.effective_from)}</strong>{v === inForce && <StatusBadge status="approved" label="in force" />}{' '}
                {v.confirmed_at ? <span className="ok-text">confirmed by the Accountant {formatDate(v.confirmed_at)}</span>
                  : <span className="warn-text">not yet confirmed by the Accountant</span>}
                {role === 'accountant' && canWrite(role) && !v.confirmed_at && (
                  <button className="link" style={{ marginLeft: '.5rem' }} disabled={action.busy} onClick={() => action.run(async () => {
                    const { error } = await supabase.from('tax_code_versions').update({ confirmed_by: profile?.user_id ?? null, confirmed_at: new Date().toISOString() }).eq('id', v.id)
                    if (error) return friendlyError(error)
                    await refresh()
                  })}>Confirm</button>
                )}
                {(v.components ?? []).length === 0 ? <span className="muted"> · no tax</span> : (
                  <table className="compact" style={{ marginTop: '.25rem' }}><tbody>
                    {[...(v.components ?? [])].sort((a, b) => a.seq - b.seq).map((x) => (
                      <tr key={x.seq}><td>{x.seq}. {x.name}{x.is_vat && <span className="muted"> (VAT)</span>}</td><td className="num">{Math.round(Number(x.rate) * 1_000_000) / 10_000}%</td>
                        <td>on {x.basis === 'net' ? 'net' : 'net + earlier components'}</td><td>{x.recoverable ? 'claimable as input tax' : 'not claimable'}</td></tr>
                    ))}
                    {Number(v.vat_withholding_rate) > 0 && <tr><td colSpan={4} className="muted">A VAT withholding agent withholds {Math.round(Number(v.vat_withholding_rate) * 10000) / 100}% of the VAT.</td></tr>}
                  </tbody></table>
                )}
              </div>
            ))}
          </div>
        )
      })}
      {adding && <AddTaxVersion code={adding} onClose={() => setAdding(null)} onSaved={refresh} />}
    </div>
  )
}

function AddTaxVersion({ code, onClose, onSaved }: { code: { id: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(GO_LIVE_MONTH)
  const [withholding, setWithholding] = useState('0')
  const [rows, setRows] = useState<Component[]>(code.name === 'Standard' ? [
    { seq: 1, name: 'NHIL', rate: '', basis: 'net', recoverable: false, is_vat: false },
    { seq: 2, name: 'GETFund', rate: '', basis: 'net', recoverable: false, is_vat: false },
    { seq: 3, name: 'VAT', rate: '', basis: 'net', recoverable: true, is_vat: true },
  ] : [])
  const action = useAction()
  const set = (i: number, patch: Partial<Component>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function save(e: FormEvent) {
    e.preventDefault()
    const ok = await action.run(async () => {
      const comps = rows.filter((r) => r.name.trim())
      for (const c of comps) {
        const n = Number(c.rate)
        if (c.rate.trim() === '' || !Number.isFinite(n) || n < 0 || n >= 100) return `${c.name}: enter the rate as a percentage.`
      }
      const w = Number(withholding)
      if (!Number.isFinite(w) || w < 0 || w > 100) return 'VAT withholding: enter a percentage.'
      const { data: v, error } = await supabase.from('tax_code_versions').insert({ tax_code_id: code.id, effective_from: date, vat_withholding_rate: w / 100 }).select('id').single()
      if (error) return friendlyError(error)
      if (comps.length) {
        const { error: e2 } = await supabase.from('tax_code_components').insert(comps.map((c, i) => ({
          version_id: v.id, seq: i + 1, name: c.name.trim(), rate: Math.round(Number(c.rate) * 10_000) / 1_000_000, basis: c.basis, recoverable: c.recoverable, is_vat: c.is_vat,
        })))
        if (e2) { await supabase.from('tax_code_versions').delete().eq('id', v.id); return friendlyError(e2) }
      }
      onSaved()
    })
    if (ok) onClose()
  }

  return (
    <Dialog title={`${code.name}: rates from a date`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label>Effective from<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <p className="muted small">List the components in the order they're worked out. Leave the list empty for a code with no tax (e.g. Exempt, No VAT).
          The rates shown are placeholders to fill in: nothing is assumed.</p>
        <div className="table-wrap"><table className="compact">
          <thead><tr><th>Component</th><th className="num">Rate %</th><th>Worked out on</th><th>Claimable</th><th>Is the VAT</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td><input value={r.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Component name" /></td>
              <td><input value={r.rate} inputMode="decimal" onChange={(e) => set(i, { rate: e.target.value })} style={{ width: '6rem' }} aria-label="Rate" /></td>
              <td><select value={r.basis} onChange={(e) => set(i, { basis: e.target.value as Component['basis'] })}>
                <option value="net">Net</option><option value="net_plus_prior">Net + earlier components</option></select></td>
              <td><input type="checkbox" checked={r.recoverable} onChange={(e) => set(i, { recoverable: e.target.checked })} aria-label="Claimable" /></td>
              <td><input type="checkbox" checked={r.is_vat} onChange={(e) => set(i, { is_vat: e.target.checked })} aria-label="Is the VAT" /></td>
              <td><button type="button" className="link" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        <button type="button" onClick={() => setRows([...rows, { seq: rows.length + 1, name: '', rate: '', basis: 'net', recoverable: false, is_vat: false }])}>+ Component</button>
        <label>VAT withheld by a withholding agent (% of the VAT)<input value={withholding} inputMode="decimal" onChange={(e) => setWithholding(e.target.value)} />
          <span className="help">D-019. 0 if clients don't withhold VAT on this code.</span></label>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Save</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Statutory calendar (brief §9; to be confirmed with the Accountant)
// ---------------------------------------------------------------------------
const RULE_KINDS: [string, string][] = [['day_of_next_month', 'A day of the next month'], ['last_working_day_next_month', 'Last working day of the next month'],
  ['quarter_end', 'Each quarter end'], ['months_after_year_end', 'Months after the year end'], ['manual', 'Entered by hand']]

export function StatutoryCalendarPanel() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ['due-rules'], queryFn: async () => (await supabase.from('statutory_due_rules').select('*').order('label')).data ?? [] })
  const [edit, setEdit] = useState<Record<string, { payee: string; rule_kind: string; day_of_month: string; months_after: string; notes: string }>>({})
  const action = useAction()
  const writer = canWrite(role) && (role === 'owner' || role === 'accountant')

  const save = (type: string) => action.run(async () => {
    const e = edit[type]
    const day = e.day_of_month.trim() === '' ? null : Number(e.day_of_month)
    const months = e.months_after.trim() === '' ? null : Number(e.months_after)
    if (e.rule_kind === 'day_of_next_month' && (!day || day < 1 || day > 31)) return 'Enter the day of the month (1 to 31).'
    if (e.rule_kind === 'months_after_year_end' && (!months || months < 1)) return 'Enter the number of months after the year end.'
    const { error } = await supabase.from('statutory_due_rules').update({ payee: e.payee.trim() || null, rule_kind: e.rule_kind, day_of_month: day, months_after: months, notes: e.notes.trim() || null }).eq('type', type)
    if (error) return friendlyError(error)
    setEdit((x) => { const y = { ...x }; delete y[type]; return y })
    await qc.invalidateQueries({ queryKey: ['due-rules'] })
  })

  return (
    <div className="stack">
      <p className="muted small">When each obligation falls due, for the statutory ledger and its reminders (7 days before and on the day). Defaults from the brief, to be confirmed with the Accountant.
        A changed rule applies to lines created from now on.</p>
      {action.error && <p className="form-error">{action.error}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Obligation</th><th>Payee</th><th>Due</th><th>Notes</th><th /></tr></thead>
        <tbody>{(rules.data ?? []).map((r) => {
          const e = edit[r.type]
          if (e) return (
            <tr key={r.type}>
              <td>{r.label}</td>
              <td><input value={e.payee} onChange={(x) => setEdit({ ...edit, [r.type]: { ...e, payee: x.target.value } })} aria-label="Payee" /></td>
              <td><select value={e.rule_kind} onChange={(x) => setEdit({ ...edit, [r.type]: { ...e, rule_kind: x.target.value } })}>{RULE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {e.rule_kind === 'day_of_next_month' && <input value={e.day_of_month} inputMode="numeric" placeholder="day" style={{ width: '5rem', marginTop: '.25rem' }} onChange={(x) => setEdit({ ...edit, [r.type]: { ...e, day_of_month: x.target.value } })} aria-label="Day of month" />}
                {e.rule_kind === 'months_after_year_end' && <input value={e.months_after} inputMode="numeric" placeholder="months" style={{ width: '5rem', marginTop: '.25rem' }} onChange={(x) => setEdit({ ...edit, [r.type]: { ...e, months_after: x.target.value } })} aria-label="Months after year end" />}</td>
              <td><input value={e.notes} onChange={(x) => setEdit({ ...edit, [r.type]: { ...e, notes: x.target.value } })} aria-label="Notes" /></td>
              <td className="row-actions"><button className="primary" disabled={action.busy} onClick={() => save(r.type)}>Save</button>
                <button className="link" onClick={() => setEdit((x) => { const y = { ...x }; delete y[r.type]; return y })}>Cancel</button></td>
            </tr>
          )
          return (
            <tr key={r.type}>
              <td>{r.label}</td><td>{r.payee ?? <span className="warn-text">not set</span>}</td>
              <td>{r.rule_kind === 'day_of_next_month' ? `${r.day_of_month}th of the next month` : r.rule_kind === 'months_after_year_end' ? `${r.months_after} months after the year end`
                : RULE_KINDS.find(([k]) => k === r.rule_kind)?.[1]}</td>
              <td className="small">{r.notes}</td>
              <td>{writer && <button className="link" onClick={() => setEdit({ ...edit, [r.type]: { payee: r.payee ?? '', rule_kind: r.rule_kind,
                day_of_month: r.day_of_month === null ? '' : String(r.day_of_month), months_after: r.months_after === null ? '' : String(r.months_after), notes: r.notes ?? '' } })}>Edit</button>}</td>
            </tr>
          )
        })}</tbody>
      </table></div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Setup wizard (brief §10): everything §11 leaves blank, in order.
// ---------------------------------------------------------------------------
const openingArrears: ResourceDef = {
  ...R.statutoryLines, key: 'opening_arrears', title: 'Opening statutory arrears', singular: 'Opening arrears line',
  description: 'What was owed at 30 Sep 2026, one line per type (about GHS 52,500 over six months, brief §11). Each shows as overdue until paid.',
  listFilter: { is_opening_arrears: true }, createDefaults: { is_opening_arrears: true },
  // The note shows next to the figure everywhere, e.g. "estimate, awaiting trustee statement" (D-036).
  fields: R.statutoryLines.fields.map((f) => (f.name === 'notes'
    ? { ...f, label: 'Note', list: true, help: 'Shown next to the figure, e.g. "estimate, awaiting trustee statement".' } : f)),
}

export function useSetupStatus() {
  const { role } = useAuth()
  return useQuery({
    queryKey: ['setup-status'],
    enabled: role === 'owner',
    queryFn: async () => {
      const today = todayAccra()
      const [settings, accounts, codes, arrears, wht, users, credits] = await Promise.all([
        supabase.from('settings_versions').select('*').lte('effective_from', today).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('accounts').select('id, name, opening_balance, opening_date'),
        supabase.from('tax_codes').select('id, is_active, versions:tax_code_versions(effective_from, confirmed_at)'),
        supabase.from('statutory_lines').select('id, amount_due').eq('is_opening_arrears', true),
        supabase.from('wht_rates').select('id'),
        supabase.from('user_directory').select('user_id, role'),
        supabase.from('tax_credits').select('amount'),
      ])
      const s = settings.data
      const activeCodes = (codes.data ?? []).filter((c) => c.is_active)
      return {
        company: !!(s?.tin && s.vat_number && s.address && s.invoice_payment_details && s.tier2_trustee),
        accounts: (accounts.data ?? []).length > 0,
        accountsDetail: accounts.data ?? [],
        taxCodes: activeCodes.length > 0 && activeCodes.every((c) => (c.versions ?? []).some((v) => v.effective_from <= today)),
        taxConfirmed: activeCodes.every((c) => (c.versions ?? []).some((v) => v.confirmed_at)),
        arrears: (arrears.data ?? []).length > 0,
        arrearsTotal: (arrears.data ?? []).reduce((a, l) => a + Number(l.amount_due), 0),
        credits: (credits.data ?? []).length > 0,
        creditsTotal: (credits.data ?? []).reduce((a, c) => a + Number(c.amount), 0),
        wht: (wht.data ?? []).length > 0,
        bonus: !!(s?.bonus_base && s.bonus_eligibility),
        users: (users.data ?? []).length > 1,
      }
    },
  })
}

export function SetupWizard() {
  const status = useSetupStatus()
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const s = status.data
  const refresh = () => qc.invalidateQueries({ queryKey: ['setup-status'] })
  const steps: { key: string; title: string; done: boolean; note: string; body: () => ReactNode }[] = s ? [
    { key: 'company', title: '1. Company and tax details', done: s.company, note: 'TIN, VAT number, address, payment details for invoices, Tier 2 trustee.',
      body: () => <SettingsForm groups={['company', 'payment']} defaultDate={GO_LIVE_MONTH} onSaved={refresh} /> },
    { key: 'accounts', title: '2. Accounts and opening balances', done: s.accounts,
      note: `Each account's closing balance on 30 Sep 2026, with the opening date 1 Oct 2026 (D-029). Operating account: Prudential Bank, A/C ending 0010 (GHS 83,115.12).${s.accountsDetail.length ? ` Entered: ${s.accountsDetail.map((a) => `${a.name} ${formatMoney(a.opening_balance)}`).join(', ')}.` : ''}`,
      body: () => <p><Link to="/accounts">Open Accounts</Link> and add each one.</p> },
    { key: 'tax', title: '3. Tax codes and rates', done: s.taxCodes, note: s.taxCodes && !s.taxConfirmed ? 'Rates entered; waiting for the Accountant to confirm them.' : 'VAT and each levy, with their order and basis. The Accountant confirms them.',
      body: () => <TaxCodesPanel /> },
    { key: 'arrears', title: '4. Statutory arrears and credits', done: s.arrears,
      note: `${s.arrears ? `${formatMoney(s.arrearsTotal)} of arrears entered.` : 'PAYE, SSNIT Tier 1, SSNIT Tier 2 and any others owed at 30 Sep 2026.'} ${s.credits ? `${formatMoney(s.creditsTotal)} owed to MeLiNS entered.` : 'Also what GRA owes MeLiNS (VAT overpaid: GHS 9,482.80, D-032).'}`,
      body: () => <><ResourceList resource={openingArrears} /><ResourceList resource={R.taxCredits} /></> },
    { key: 'wht', title: '5. WHT rates', done: s.wht, note: 'Rates MeLiNS deducts from suppliers and on directors\' fees and dividends, and client WHT categories. Per diem rates come with trips in Phase B.',
      body: () => <ResourceList resource={R.whtRates} /> },
    { key: 'bonus', title: '6. Bonus rule and leave', done: s.bonus, note: '13th-month bonus base and who qualifies; leave carry-over. Leave types\' default days are under Reference data › Leave types.',
      body: () => <SettingsForm groups={['bonus', 'time']} defaultDate={GO_LIVE_MONTH} onSaved={refresh} /> },
    { key: 'users', title: '7. Users', done: s.users, note: 'Invite the Directors, the Accountant and staff, each linked to their record.', body: () => <UsersPanel /> },
  ] : []
  const done = steps.filter((x) => x.done).length

  if (status.isLoading) return <p className="muted">Checking…</p>
  return (
    <div className="stack">
      <p>{done === steps.length ? <strong className="ok-text">Setup is complete.</strong> : <><strong>{done} of {steps.length}</strong> steps done.</>}
        <span className="muted small"> Settings saved here apply from go-live, 1 Oct 2026. Nothing is guessed: rates and numbers you leave blank stay blank (brief §11).</span></p>
      {steps.map((x) => (
        <div key={x.key} className="panel">
          <div className="page-header" style={{ marginBottom: 0 }}>
            <div><h3 style={{ margin: 0 }}>{x.done ? '✓ ' : ''}{x.title}</h3><p className="muted small" style={{ margin: 0 }}>{x.note}</p></div>
            <button onClick={() => setOpen(open === x.key ? null : x.key)}>{open === x.key ? 'Close' : x.done ? 'Review' : 'Start'}</button>
          </div>
          {open === x.key && <div style={{ marginTop: '1rem' }}>{x.body()}</div>}
        </div>
      ))}
    </div>
  )
}
