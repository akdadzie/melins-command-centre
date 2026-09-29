import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { Money, PromptDialog, StatusBadge, useAction } from '../../components/ui'
import { formatDate, formatMoney, parseMoney } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import { friendlyError } from '../../resources/useLookups'
import {
  accountantMayApprove, getCreditNotes, getInvoice, getInvoiceLines, getPayments, taxSummary, type Invoice, type InvoiceLine,
} from './api'
import { InvoicePrint } from './InvoicePrint'

export function InvoiceDetail() {
  const { number = '' } = useParams()
  const { role } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const inv = useQuery({ queryKey: ['invoice', number], queryFn: () => getInvoice(number) })
  const invoice = inv.data
  const lines = useQuery({ queryKey: ['invoice-lines', invoice?.id], queryFn: () => getInvoiceLines(invoice!.id), enabled: !!invoice })
  const credits = useQuery({ queryKey: ['credit-notes', invoice?.id], queryFn: () => getCreditNotes(invoice!.id), enabled: !!invoice })
  const payments = useQuery({ queryKey: ['invoice-payments', invoice?.id], queryFn: () => getPayments(invoice!.id), enabled: !!invoice })
  const acctMay = useQuery({ queryKey: ['acct-may-approve'], queryFn: accountantMayApprove, enabled: role === 'accountant' })
  const action = useAction()
  const [prompt, setPrompt] = useState<null | 'dispute' | 'writeoff' | 'credit'>(null)
  const [printing, setPrinting] = useState(false)

  if (inv.isLoading) return <p className="muted">Loading…</p>
  if (inv.error) return <p className="form-error">{friendlyError(inv.error as Error)}</p>
  if (!invoice) return <section className="notice"><h1>Invoice not found</h1><p>It doesn't exist, or your role can't see it.</p><Link to="/invoices">All invoices</Link></section>

  const writer = canWrite(role)
  const draft = invoice.status === 'draft'
  const canEditDraft = writer && draft && ['owner', 'accountant', 'admin', 'project_lead'].includes(role ?? '')
  const canApprove = draft && (role === 'owner' || (role === 'accountant' && acctMay.data === true))
  const open = ['approved', 'sent', 'part_paid', 'disputed'].includes(invoice.status)
  const key = invoice.invoice_number ?? invoice.draft_ref

  async function refresh(newKey?: string) {
    await qc.invalidateQueries({ queryKey: ['invoices'] })
    await qc.invalidateQueries({ queryKey: ['invoice'] })
    await qc.invalidateQueries({ queryKey: ['invoice-lines'] })
    await qc.invalidateQueries({ queryKey: ['credit-notes'] })
    if (newKey && newKey !== number) navigate(`/invoices/${newKey}`, { replace: true })
  }

  const update = (patch: Record<string, unknown>) => action.run(async () => {
    const { data, error } = await db.from('invoices').update(patch).eq('id', invoice.id).select('invoice_number, draft_ref').maybeSingle()
    if (error) return friendlyError(error)
    if (!data) return 'Nothing changed: your role may not be allowed to do this.'
    await refresh(data.invoice_number ?? data.draft_ref)
  })

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="muted small"><Link to="/invoices">Invoices</Link></p>
          <h1>{key} <StatusBadge status={draft && invoice.ready_for_approval ? 'submitted' : invoice.status}
                               label={draft && invoice.ready_for_approval ? 'awaiting approval' : undefined} /></h1>
          <p className="muted">{invoice.client?.name} · <Link to={`/jobs/${invoice.job?.job_number}`}>{invoice.job?.job_number} {invoice.job?.title}</Link>
            {invoice.is_imported && ' · opening receivable'}</p>
        </div>
        <div className="actions">
          {canEditDraft && !invoice.ready_for_approval && <button onClick={() => update({ ready_for_approval: true })} disabled={action.busy}>Submit for approval</button>}
          {canApprove && <button className="primary" onClick={() => update({ status: 'approved' })} disabled={action.busy}>Approve and number</button>}
          {writer && invoice.status === 'approved' && role !== 'project_lead' && <button className="primary" onClick={() => update({ status: 'sent' })} disabled={action.busy}>Mark as sent</button>}
          {writer && ['approved', 'sent', 'part_paid'].includes(invoice.status) && role !== 'project_lead' && <button onClick={() => setPrompt('dispute')}>Dispute</button>}
          {writer && invoice.status === 'disputed' && <button onClick={() => update({ status: 'sent' })}>Dispute resolved</button>}
          {role === 'owner' && open && <button onClick={() => setPrompt('writeoff')}>Write off</button>}
          {(role === 'owner' || role === 'accountant') && open && <button onClick={() => setPrompt('credit')}>Credit note</button>}
          <button onClick={() => setPrinting(true)}>{draft ? 'Preview' : 'Print / PDF'}</button>
          {canEditDraft && <button className="link" onClick={() => action.run(async () => {
            if (!confirm('Delete this draft?')) return
            const { error } = await supabase.from('invoices').delete().eq('id', invoice.id)
            if (error) return friendlyError(error)
            await qc.invalidateQueries({ queryKey: ['invoices'] }); navigate('/invoices')
          })}>Delete draft</button>}
        </div>
      </header>
      {action.error && <p className="form-error">{action.error}</p>}
      {invoice.status === 'disputed' && <p className="form-error">Disputed since {formatDate(invoice.dispute_date)}: {invoice.dispute_reason}{invoice.dispute_next_step && ` · Next step: ${invoice.dispute_next_step}`}</p>}
      {invoice.status === 'written_off' && <p className="form-error">Written off ({formatMoney(invoice.write_off_amount)}): {invoice.write_off_reason}</p>}

      <div className="detail-grid">
        <HeaderFields invoice={invoice} editable={canEditDraft} onSaved={() => refresh()} />
        <Totals invoice={invoice} lines={lines.data ?? []} />
      </div>

      <h2>Lines</h2>
      <LinesTable invoice={invoice} lines={lines.data ?? []} editable={canEditDraft} onChanged={() => refresh()} />
      {canEditDraft && <AddLine invoice={invoice} onAdded={() => refresh()} />}

      {(credits.data ?? []).length > 0 && (
        <>
          <h2>Credit notes</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Credit note</th><th>Date</th><th>Reason</th><th className="num">Gross</th><th>Status</th><th /></tr></thead>
            <tbody>{credits.data!.map((c) => (
              <tr key={c.id}>
                <td>{c.cn_number ?? c.draft_ref}</td><td>{formatDate(c.cn_date)}</td><td>{c.reason}</td>
                <td><Money value={c.gross_amount} /></td><td><StatusBadge status={c.status} /></td>
                <td>{role === 'owner' && c.status === 'draft' && (
                  <button onClick={() => action.run(async () => {
                    const { error } = await supabase.from('credit_notes').update({ status: 'approved' }).eq('id', c.id)
                    if (error) return friendlyError(error)
                    await refresh()
                  })}>Approve</button>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {(payments.data ?? []).length > 0 && (
        <>
          <h2>Payments</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th className="num">Cash</th><th className="num">WHT</th><th className="num">VAT withheld</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>{payments.data!.map((p) => (
              <tr key={p.id}>
                <td>{role !== 'project_lead' ? <Link to={`/receipts?id=${p.receipt?.id}`}>{formatDate(p.receipt?.receipt_date)}</Link> : formatDate(p.receipt?.receipt_date)}</td>
                <td><Money value={p.cash_amount} /></td><td><Money value={p.wht_amount} /></td><td><Money value={p.vat_withheld_amount} /></td>
                <td>{p.receipt?.method?.replace(/_/g, ' ')} {p.receipt?.reference}</td>
                <td><StatusBadge status={p.receipt?.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {prompt === 'dispute' && (
        <PromptDialog title="Dispute this invoice" label="Reason" confirmLabel="Mark disputed" onClose={() => setPrompt(null)}
          onSubmit={async (reason) => {
            const { error } = await db.from('invoices').update({ status: 'disputed', dispute_reason: reason }).eq('id', invoice.id)
            if (error) return friendlyError(error)
            await refresh(); return null
          }} />
      )}
      {prompt === 'writeoff' && (
        <PromptDialog title={`Write off ${formatMoney(invoice.outstanding)}`} label="Reason (reported as bad debt)" confirmLabel="Write off"
          onClose={() => setPrompt(null)}
          onSubmit={async (reason) => {
            const { error } = await db.from('invoices').update({ status: 'written_off', write_off_reason: reason }).eq('id', invoice.id)
            if (error) return friendlyError(error)
            await refresh(); return null
          }} />
      )}
      {prompt === 'credit' && <CreditNoteDialog invoice={invoice} lines={lines.data ?? []} onClose={() => setPrompt(null)} onSaved={() => refresh()} />}
      {printing && <InvoicePrint invoice={invoice} lines={lines.data ?? []} onClose={() => setPrinting(false)} />}
    </section>
  )
}

function HeaderFields({ invoice, editable, onSaved }: { invoice: Invoice; editable: boolean; onSaved: () => void }) {
  const [date, setDate] = useState(invoice.invoice_date)
  const [due, setDue] = useState(invoice.due_date ?? '')
  const [gra, setGra] = useState(invoice.gra_einvoice_ref ?? '')
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const action = useAction()
  const dirty = date !== invoice.invoice_date || due !== (invoice.due_date ?? '') || gra !== (invoice.gra_einvoice_ref ?? '') || notes !== (invoice.notes ?? '')
  const canEditRefs = canWrite(useAuth().role) && invoice.status !== 'draft'

  function save(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const patch: Record<string, unknown> = { gra_einvoice_ref: gra || null, notes: notes || null }
      if (editable) { patch.invoice_date = date; patch.due_date = due || null }
      const { error } = await db.from('invoices').update(patch).eq('id', invoice.id)
      if (error) return friendlyError(error)
      onSaved()
    })
  }

  return (
    <form className="panel form-grid" onSubmit={save}>
      <label>Invoice date<input type="date" value={date} disabled={!editable} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Due date<input type="date" value={due} disabled={!editable} onChange={(e) => setDue(e.target.value)} /></label>
      <label>GRA e-invoice reference<input value={gra} disabled={!editable && !canEditRefs} onChange={(e) => setGra(e.target.value)} /></label>
      <label>Notes<input value={notes} disabled={!editable && !canEditRefs} onChange={(e) => setNotes(e.target.value)} /></label>
      {editable && <p className="help">Changing the date re-prices every line at the tax rates in force on the new date.</p>}
      {action.error && <p className="form-error">{action.error}</p>}
      {dirty && <div><button className="primary" disabled={action.busy}>Save</button></div>}
    </form>
  )
}

function Totals({ invoice, lines }: { invoice: Invoice; lines: InvoiceLine[] }) {
  const taxes = taxSummary(lines)
  const row = (label: string, value: number | null, opts: { strong?: boolean; minus?: boolean; muted?: boolean } = {}) => (
    <tr className={opts.muted ? 'muted' : undefined}>
      <td>{label}</td><td className="num">{opts.minus && Number(value) ? '−' : ''}<Money value={value} strong={opts.strong} /></td>
    </tr>
  )
  return (
    <div className="panel">
      <table className="totals"><tbody>
        {row('Net', invoice.net_total)}
        {taxes.map((t) => row(`${t.name}${t.rate !== null ? ` @ ${Math.round(t.rate * 100000) / 1000}%` : ''}`, t.amount))}
        {invoice.is_imported && taxes.length === 0 && row('VAT and levies', invoice.tax_total)}
        {row('Gross', invoice.gross_total, { strong: true })}
        {Number(invoice.retention_amount) > 0 && row(`Less retention (${invoice.retention_pct}% of ${invoice.retention_basis})`, invoice.retention_amount, { minus: true })}
        {Number(invoice.expected_wht) > 0 && row(`Expected WHT (${Math.round(Number(invoice.wht_rate) * 10000) / 100}%)`, invoice.expected_wht, { minus: true, muted: true })}
        {Number(invoice.expected_vat_withheld) > 0 && row('Expected VAT withheld', invoice.expected_vat_withheld, { minus: true, muted: true })}
        {row('Expected net receipt', invoice.expected_net_receipt, { muted: true })}
        {invoice.status !== 'draft' && <>
          {Number(invoice.credited_total) > 0 && row('Credit notes', invoice.credited_total, { minus: true })}
          {row(`Settled${Number(invoice.settled_total) !== Number(invoice.confirmed_settled_total) ? ' (incl. reported, not yet confirmed)' : ''}`, invoice.settled_total, { minus: true })}
          {row('Outstanding', invoice.outstanding, { strong: true })}
        </>}
      </tbody></table>
    </div>
  )
}

function LinesTable({ invoice, lines, editable, onChanged }: { invoice: Invoice; lines: InvoiceLine[]; editable: boolean; onChanged: () => void }) {
  const action = useAction()
  if (lines.length === 0) return <p className="empty">{invoice.is_imported ? 'Imported with totals only.' : 'No lines yet.'}</p>
  return (
    <>
      {action.error && <p className="form-error">{action.error}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Description</th><th>Type</th><th>Tax code</th><th className="num">Net</th><th className="num">Tax</th><th className="num">Gross</th>{editable && <th />}</tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.id}>
            <td>{l.description}{l.milestone && <div className="muted small">Milestone: {l.milestone.name}</div>}</td>
            <td>{l.line_type.replace(/_/g, ' ')}</td>
            <td>{l.tax_code?.name ?? '—'}</td>
            <td><Money value={l.net_amount} /></td><td><Money value={l.tax_amount} /></td><td><Money value={l.gross_amount} /></td>
            {editable && <td><button className="link" disabled={action.busy} onClick={() => action.run(async () => {
              const { error } = await supabase.from('invoice_lines').delete().eq('id', l.id)
              if (error) return friendlyError(error)
              onChanged()
            })}>Remove</button></td>}
          </tr>
        ))}</tbody>
      </table></div>
    </>
  )
}

type LineType = 'fee' | 'milestone' | 'rechargeable_expense' | 'retention_release' | 'other'

function AddLine({ invoice, onAdded }: { invoice: Invoice; onAdded: () => void }) {
  const [type, setType] = useState<LineType>('fee')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [taxCode, setTaxCode] = useState('')
  const [pick, setPick] = useState('')
  const action = useAction()
  const taxCodes = useQuery({ queryKey: ['tax-codes'], queryFn: async () => (await supabase.from('tax_codes').select('id, name').eq('is_active', true).order('name')).data ?? [] })
  const milestones = useQuery({
    queryKey: ['milestones-for-invoice', invoice.job_id],
    queryFn: async () => (await supabase.from('billing_milestones').select('id, name, amount, status')
      .eq('job_id', invoice.job_id).in('status', ['pending', 'reached']).order('seq')).data ?? [],
  })
  const recharges = useQuery({
    queryKey: ['recharges-for-invoice', invoice.job_id],
    queryFn: async () => (await supabase.from('ready_to_invoice').select('item_id, description, amount')
      .eq('job_id', invoice.job_id).eq('item_type', 'rechargeable_expense')).data ?? [],
  })
  const defaultTax = taxCode || taxCodes.data?.find((t) => t.name === 'Standard')?.id || ''

  function choose(id: string) {
    setPick(id)
    if (type === 'milestone') {
      const m = milestones.data?.find((x) => x.id === id)
      if (m) { setDescription(m.name); setAmount(m.amount === null ? '' : String(m.amount)) }
    } else if (type === 'rechargeable_expense') {
      const r = recharges.data?.find((x) => x.item_id === id)
      if (r) { setDescription(`Recharge: ${r.description}`); setAmount(r.amount === null ? '' : String(r.amount)) }
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const net = amount.trim() === '' && type !== 'fee' && type !== 'other' && type !== 'retention_release' ? null : parseMoney(amount)
      if (net === null && (type === 'fee' || type === 'other' || type === 'retention_release')) return 'Enter the amount'
      const row: Record<string, unknown> = {
        invoice_id: invoice.id, line_type: type, description, net_amount: net,
        tax_code_id: type === 'retention_release' ? null : defaultTax || null,
        billing_milestone_id: type === 'milestone' ? pick : null,
        expense_id: type === 'rechargeable_expense' ? pick : null,
      }
      const { error } = await db.from('invoice_lines').insert(row)
      if (error) return friendlyError(error)
      setDescription(''); setAmount(''); setPick('')
      onAdded()
    })
  }

  return (
    <form className="panel add-line" onSubmit={submit}>
      <h3>Add a line</h3>
      <div className="form-grid">
        <label>Type
          <select value={type} onChange={(e) => { setType(e.target.value as LineType); setPick(''); setDescription(''); setAmount('') }}>
            <option value="fee">Fee</option>
            <option value="milestone">Billing milestone</option>
            <option value="rechargeable_expense">Rechargeable expense</option>
            <option value="retention_release">Retention release (no tax)</option>
            <option value="other">Other</option>
          </select>
        </label>
        {type === 'milestone' && (
          <label>Milestone
            <select value={pick} onChange={(e) => choose(e.target.value)} required>
              <option value="">Choose…</option>
              {(milestones.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.status}) · {formatMoney(m.amount)}</option>)}
            </select>
          </label>
        )}
        {type === 'rechargeable_expense' && (
          <label>Expense to recharge
            <select value={pick} onChange={(e) => choose(e.target.value)} required>
              <option value="">{recharges.data?.length ? 'Choose…' : 'None waiting on this job'}</option>
              {(recharges.data ?? []).map((r) => <option key={r.item_id!} value={r.item_id!}>{r.description} · {formatMoney(r.amount)}</option>)}
            </select>
          </label>
        )}
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} required /></label>
        <label>Net amount (GHS)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={type === 'rechargeable_expense' ? 'cost + markup' : ''} /></label>
        {type !== 'retention_release' && (
          <label>Tax code
            <select value={defaultTax} onChange={(e) => setTaxCode(e.target.value)}>
              <option value="">No tax</option>
              {(taxCodes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {action.error && <p className="form-error">{action.error}</p>}
      <div className="form-actions"><button className="primary" disabled={action.busy}>Add line</button></div>
    </form>
  )
}

function CreditNoteDialog({ invoice, lines, onClose, onSaved }: { invoice: Invoice; lines: InvoiceLine[]; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('')
  const [net, setNet] = useState('')
  const firstTax = lines.find((l) => l.tax_code_id)?.tax_code_id ?? ''
  const [taxCode, setTaxCode] = useState(firstTax)
  const taxCodes = useQuery({ queryKey: ['tax-codes'], queryFn: async () => (await supabase.from('tax_codes').select('id, name').order('name')).data ?? [] })
  const action = useAction()
  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const amount = parseMoney(net)
      if (!amount || amount <= 0) return 'Enter the net amount to credit'
      const { error } = await db.from('credit_notes').insert({ invoice_id: invoice.id, reason, net_amount: amount, tax_code_id: taxCode || null })
      if (error) return friendlyError(error)
      onSaved(); onClose()
    })
  }
  return (
    <Dialog title={`Credit note against ${invoice.invoice_number}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">VAT and levies are reversed at the rates on the invoice date. The Owner approves it, and it gets its CN number then. It can't exceed {formatMoney(invoice.outstanding)} outstanding.</p>
        <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
        <label>Net amount to credit (GHS)<input inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} required /></label>
        <label>Tax code
          <select value={taxCode} onChange={(e) => setTaxCode(e.target.value)}>
            <option value="">No tax</option>
            {(taxCodes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Create credit note</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}
