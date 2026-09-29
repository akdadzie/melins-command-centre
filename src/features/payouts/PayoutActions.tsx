import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { PromptDialog, StatusBadge, useAction } from '../../components/ui'
import { formatDate, todayAccra } from '../../lib/format'
import { db } from '../../lib/supabase'
import { lookups } from '../../resources/lookups'
import { fetchLookupRows, friendlyError } from '../../resources/useLookups'

export interface PayoutRow {
  id: string
  status: string
  prepared_by: string | null
  approved_at?: string | null
  paid_at?: string | null
  payment_date?: string | null
  review_status?: string | null
  query_note?: string | null
}

const METHODS = [['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['mobile_money', 'Mobile money'], ['other', 'Other']] as const

/**
 * Prepared -> Approved (Owner, the bank signatory) -> Paid (date, account,
 * reference) -> Reviewed (Accountant). Brief §4 / DECISIONS A-028. The
 * database enforces every step; this only offers the buttons that make sense.
 */
export function PayoutActions({ table, row, onChanged, payRoles = ['owner', 'accountant', 'admin'] }: {
  table: string
  row: PayoutRow
  onChanged: () => void
  payRoles?: string[]
}) {
  const { role, profile } = useAuth()
  const action = useAction()
  const [paying, setPaying] = useState(false)
  const writer = canWrite(role)

  const set = (patch: Record<string, unknown>) => action.run(async () => {
    const { data, error } = await db.from(table).update(patch).eq('id', row.id).select('id').maybeSingle()
    if (error) return friendlyError(error)
    if (!data) return 'Nothing changed: your role may not be allowed to do this.'
    onChanged()
  })

  return (
    <div className="payout-bar">
      <div className="steps">
        <StatusBadge status={row.status} />
        {row.approved_at && <span className="muted small">approved {formatDate(row.approved_at)}</span>}
        {row.payment_date && row.status === 'paid' && <span className="muted small">paid {formatDate(row.payment_date)}</span>}
        {row.review_status && row.status === 'paid' && <StatusBadge status={row.review_status === 'not_required' ? 'reviewed' : row.review_status} label={`review: ${row.review_status.replace('_', ' ')}`} />}
      </div>
      {writer && (
        <div className="actions">
          {row.status === 'prepared' && role === 'owner' && <button className="primary" disabled={action.busy} onClick={() => set({ status: 'approved' })}>Approve</button>}
          {row.status === 'approved' && payRoles.includes(role ?? '') && <button className="primary" onClick={() => setPaying(true)}>Record as paid</button>}
          {row.status === 'approved' && ['owner', 'accountant', 'admin'].includes(role ?? '') && <button disabled={action.busy} onClick={() => set({ status: 'prepared' })}>Send back</button>}
          {(row.status === 'prepared' || row.status === 'approved') && (role === 'owner' || (row.status === 'prepared' && row.prepared_by === profile?.user_id)) &&
            <button disabled={action.busy} onClick={() => confirm('Cancel this payment?') && set({ status: 'cancelled' })}>Cancel</button>}
        </div>
      )}
      <ReviewActions table={table} row={row} onChanged={onChanged} />
      {row.review_status === 'queried' && row.query_note && <p className="form-error">Queried: {row.query_note}</p>}
      {action.error && <p className="form-error">{action.error}</p>}
      {paying && <MarkPaid table={table} id={row.id} onClose={() => setPaying(false)} onDone={() => { setPaying(false); onChanged() }} />}
    </div>
  )
}

/** Accountant review of a money entry (brief §4): Reviewed, or Queried with a note. */
export function ReviewActions({ table, row, onChanged }: { table: string; row: { id: string; review_status?: string | null; status?: string }; onChanged: () => void }) {
  const { role } = useAuth()
  const action = useAction()
  const [querying, setQuerying] = useState(false)
  if (role !== 'accountant' || !row.review_status || !['recorded', 'queried'].includes(row.review_status)) return null
  if (row.status && !['paid'].includes(row.status) && table !== 'expenses' && table !== 'transfers') return null
  return (
    <div className="actions">
      <button disabled={action.busy} onClick={() => action.run(async () => {
        const { error } = await db.from(table).update({ review_status: 'reviewed' }).eq('id', row.id)
        if (error) return friendlyError(error)
        onChanged()
      })}>Mark reviewed</button>
      <button onClick={() => setQuerying(true)}>Query</button>
      {action.error && <p className="form-error">{action.error}</p>}
      {querying && (
        <PromptDialog title="Query this entry" label="What needs fixing?" confirmLabel="Send query" onClose={() => setQuerying(false)}
          onSubmit={async (note) => {
            const { error } = await db.from(table).update({ review_status: 'queried', query_note: note }).eq('id', row.id)
            if (error) return friendlyError(error)
            onChanged(); return null
          }} />
      )}
    </div>
  )
}

function MarkPaid({ table, id, onClose, onDone }: { table: string; id: string; onClose: () => void; onDone: () => void }) {
  const accounts = useQuery({ queryKey: ['lookup', 'account_picker'], queryFn: () => fetchLookupRows(lookups.account) })
  const [date, setDate] = useState(todayAccra())
  const [account, setAccount] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const action = useAction()
  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const { error } = await db.from(table).update({ status: 'paid', payment_date: date, account_id: account, method, reference: reference || null }).eq('id', id)
      if (error) return friendlyError(error)
      onDone()
    })
  }
  return (
    <Dialog title="Record as paid" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Date paid<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Paid from account
          <select value={account} onChange={(e) => setAccount(e.target.value)} required>
            <option value="">Choose…</option>
            {(accounts.data ?? []).map((a) => <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}
          </select>
        </label>
        <label>Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label>Reference (cheque no., transfer ref.)<input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Record as paid</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}
