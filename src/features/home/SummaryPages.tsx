// /reports/monthly (A-014): the month's fees, costs, cash, tax and close status.
// /notifications: the user's own notifications, each linking to its record.
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { Money, StatusBadge, useAction } from '../../components/ui'
import { formatDate, todayAccra } from '../../lib/format'
import { defaultCloseMonth, GO_LIVE_MONTH } from '../../lib/golive'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../resources/useLookups'

interface Summary {
  month: string
  fees_invoiced: number
  fees_received: number
  costs: { expenses: number; payroll: number; directors_fees: number }
  cash_at_month_end: number
  vat_payable: number
  statutory_outstanding: number
  month_status: string
  closed_at: string | null
}

const monthLabel = (first: string) => new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function MonthlySummaryPage() {
  const [params, setParams] = useSearchParams()
  const key = params.get('month') ?? defaultCloseMonth(todayAccra()).slice(0, 7)
  const month = `${key}-01`
  const q = useQuery({
    queryKey: ['monthly-summary', month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('monthly_summary', { p_month: month })
      if (error) throw error
      return data as unknown as Summary | null
    },
  })
  const s = q.data
  const costs = s ? s.costs.expenses + s.costs.payroll + s.costs.directors_fees : 0
  return (
    <section>
      <header className="page-header">
        <div><h1>Monthly summary: {monthLabel(month)}</h1>
          <p className="muted">Fees, costs, cash and tax for the month. Figures are final once the month is closed.</p></div>
        <div className="actions">
          <input type="month" value={key} min={GO_LIVE_MONTH.slice(0, 7)} max={todayAccra().slice(0, 7)} onChange={(e) => e.target.value && setParams({ month: e.target.value })} aria-label="Month" />
          <button onClick={() => window.print()}>Print</button>
        </div>
      </header>
      {q.isLoading ? <p className="muted">Loading…</p> : !s ? <p className="empty">Not available to your role.</p> : (
        <>
          <p><StatusBadge status={s.month_status === 'closed' ? 'reviewed' : 'draft'} label={s.month_status === 'closed' ? `closed ${formatDate(s.closed_at)}` : 'open: figures may still change'} />
            {' '}<Link to={`/close/${key}`}>Month close</Link></p>
          <div className="table-wrap narrow"><table>
            <tbody>
              <tr><th colSpan={2}>Fees</th></tr>
              <tr><td>Invoiced (net of VAT, excluding opening receivables)</td><td><Money value={s.fees_invoiced} /></td></tr>
              <tr><td>Received from clients (confirmed cash)</td><td><Money value={s.fees_received} /></td></tr>
              <tr><th colSpan={2}>Costs</th></tr>
              <tr><td>Payroll (cost to company)</td><td><Money value={s.costs.payroll} /></td></tr>
              <tr><td>Expenses (net of claimable VAT)</td><td><Money value={s.costs.expenses} /></td></tr>
              <tr><td>Directors' fees and allowances</td><td><Money value={s.costs.directors_fees} /></td></tr>
              <tr className="total-row"><td>Total costs</td><td><Money value={costs} /></td></tr>
              <tr><td><strong>Fees invoiced less costs</strong></td><td><Money value={s.fees_invoiced - costs} strong /></td></tr>
              <tr><th colSpan={2}>Cash and tax</th></tr>
              <tr><td>Cash in all accounts at month end</td><td><Money value={s.cash_at_month_end} /></td></tr>
              <tr><td>VAT payable for the month</td><td><Money value={s.vat_payable} /></td></tr>
              <tr><td>Statutory obligations outstanding (all periods)</td><td><Money value={s.statutory_outstanding} /></td></tr>
            </tbody>
          </table></div>
        </>
      )}
    </section>
  )
}

export function NotificationsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const action = useAction()
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await supabase.from('notifications').select('id, kind, title, body, link, read_at, created_at')
      .order('created_at', { ascending: false }).limit(200)).data ?? [],
  })
  const unread = (list.data ?? []).filter((n) => !n.read_at)
  const markRead = (ids: string[]) => action.run(async () => {
    if (!ids.length) return
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).eq('recipient_id', profile!.user_id)
    if (error) return friendlyError(error)
    await qc.invalidateQueries({ queryKey: ['notifications'] })
  })
  return (
    <section>
      <header className="page-header">
        <div><h1>Notifications</h1><p className="muted">{unread.length} unread</p></div>
        {unread.length > 0 && <div className="actions"><button disabled={action.busy} onClick={() => markRead(unread.map((n) => n.id))}>Mark all read</button></div>}
      </header>
      {action.error && <p className="form-error">{action.error}</p>}
      {(list.data ?? []).length === 0 ? <p className="empty">No notifications yet.</p> : (
        <ul className="entry-list">{(list.data ?? []).map((n) => (
          <li key={n.id} className={n.read_at ? undefined : 'unread'}>
            <div>
              <button className="link" onClick={async () => { if (!n.read_at) await markRead([n.id]); navigate(n.link) }}>{n.title}</button>
              {n.body && <div className="small">{n.body}</div>}
              <div className="muted small">{formatDate(n.created_at)}</div>
            </div>
            {!n.read_at && <button className="link small" onClick={() => markRead([n.id])}>Mark read</button>}
          </li>
        ))}</ul>
      )}
    </section>
  )
}
