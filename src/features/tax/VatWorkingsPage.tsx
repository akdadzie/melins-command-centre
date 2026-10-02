// /tax/vat/:month (brief §7.6; acceptance 18): output VAT and levies from
// issued invoices, less approved credit notes, less claimable input tax from
// expenses with a valid VAT invoice, less VAT withheld by clients. A summary
// for the Accountant; filing stays outside the system. Each part lists the
// documents behind it and exports as CSV.
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import { Money } from '../../components/ui'
import { downloadCsv } from '../../csv/csv'
import { formatDate, todayAccra } from '../../lib/format'
import { GO_LIVE_MONTH } from '../../lib/golive'
import { supabase } from '../../lib/supabase'

const monthLabel = (first: string) => new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const nextMonth = (first: string) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10) }
const sumTaxes = (t: { amount: number; is_vat: boolean }[] | null | undefined, vat: boolean) =>
  (t ?? []).filter((x) => x.is_vat === vat).reduce((s, x) => s + Number(x.amount), 0)

export function VatWorkingsPage() {
  const { month: key = '' } = useParams()
  const navigate = useNavigate()
  const valid = /^\d{4}-\d{2}$/.test(key)
  const s = `${key}-01`
  const e = valid ? nextMonth(s) : ''

  const summary = useQuery({
    queryKey: ['vat-workings', s], enabled: valid,
    queryFn: async () => { const { data, error } = await supabase.rpc('vat_workings', { p_month: s }); if (error) throw error; return data ?? [] },
  })
  const invoices = useQuery({
    queryKey: ['vat-invoices', s], enabled: valid,
    queryFn: async () => (await supabase.from('invoices')
      .select('id, invoice_number, invoice_date, net_total, client:clients(name), lines:invoice_lines(taxes:invoice_line_taxes(amount, is_vat))')
      .neq('status', 'draft').eq('is_imported', false).gte('invoice_date', s).lt('invoice_date', e).order('invoice_number')).data ?? [],
  })
  const credits = useQuery({
    queryKey: ['vat-credits', s], enabled: valid,
    queryFn: async () => (await supabase.from('credit_notes')
      .select('id, cn_number, cn_date, net_amount, invoice:invoices(invoice_number), taxes:credit_note_taxes(amount, is_vat)')
      .eq('status', 'approved').gte('cn_date', s).lt('cn_date', e).order('cn_number')).data ?? [],
  })
  const inputs = useQuery({
    queryKey: ['vat-inputs', s], enabled: valid,
    queryFn: async () => (await supabase.from('expenses')
      .select('id, expense_date, description, net_amount, supplier:suppliers(name, ident:supplier_identifiers(tin)), taxes:expense_taxes(amount, is_vat, recoverable)')
      .eq('entry_status', 'confirmed').eq('has_valid_vat_invoice', true).gte('expense_date', s).lt('expense_date', e).order('expense_date')).data ?? [],
  })
  const withheld = useQuery({
    queryKey: ['vat-withheld', s], enabled: valid,
    queryFn: async () => (await supabase.from('receipts').select('id, receipt_date, vat_withheld_amount, reference, client:clients(name)')
      .eq('status', 'confirmed').gt('vat_withheld_amount', 0).gte('receipt_date', s).lt('receipt_date', e).order('receipt_date')).data ?? [],
  })

  if (!valid) return <section><h1>VAT workings</h1><p className="empty">Use a link like /tax/vat/2026-10.</p></section>
  const rows = summary.data ?? []
  const vatRow = rows.filter((r) => r.is_vat)
  const net = vatRow.reduce((a, r) => a + Number(r.net_payable), 0)
  const levies = rows.filter((r) => !r.is_vat)
  const tinOf = (sup: { ident: { tin: string | null } | { tin: string | null }[] | null } | null) => {
    const i = sup?.ident; return (Array.isArray(i) ? i[0]?.tin : i?.tin) ?? null
  }
  const claimable = (inputs.data ?? []).map((x) => ({ ...x, tin: tinOf(x.supplier), vat: (x.taxes ?? []).filter((t) => t.recoverable && t.is_vat).reduce((a, t) => a + Number(t.amount), 0),
    other: (x.taxes ?? []).filter((t) => t.recoverable && !t.is_vat).reduce((a, t) => a + Number(t.amount), 0) }))
    .filter((x) => x.vat + x.other > 0)

  function exportCsv() {
    const out: (string | number)[][] = [['Section', 'Date', 'Document', 'Party', 'Net', 'VAT', 'Levies']]
    for (const i of invoices.data ?? []) {
      const t = (i.lines ?? []).flatMap((l) => l.taxes ?? [])
      out.push(['Output (invoice)', i.invoice_date, i.invoice_number ?? '', i.client?.name ?? '', i.net_total, sumTaxes(t, true), sumTaxes(t, false)])
    }
    for (const c of credits.data ?? []) out.push(['Credit note', c.cn_date, c.cn_number ?? '', c.invoice?.invoice_number ?? '', -c.net_amount, -sumTaxes(c.taxes, true), -sumTaxes(c.taxes, false)])
    for (const x of claimable) out.push(['Input (expense)', x.expense_date, x.description, x.tin ? `${x.supplier?.name} (TIN ${x.tin})` : x.supplier?.name ?? '', x.net_amount ?? '', x.vat, x.other])
    for (const w of withheld.data ?? []) out.push(['VAT withheld by client', w.receipt_date, w.reference ?? '', w.client?.name ?? '', '', w.vat_withheld_amount, ''])
    for (const r of rows) out.push(['Summary', '', r.component, '', '', r.is_vat ? r.net_payable : '', r.is_vat ? '' : r.net_payable])
    downloadCsv(`vat-workings-${key}.csv`, Papa.unparse(out))
  }

  return (
    <section>
      <header className="page-header">
        <div><h1>VAT workings: {monthLabel(s)}</h1>
          <p className="muted">A summary for the Accountant to file from. Output tax counts issued invoices dated in the month (opening receivables are excluded: their VAT was declared before go-live).</p></div>
        <div className="actions">
          <input type="month" value={key} min={GO_LIVE_MONTH.slice(0, 7)} max={todayAccra().slice(0, 7)} aria-label="Month"
            onChange={(ev) => ev.target.value && navigate(`/tax/vat/${ev.target.value}`)} />
          <button onClick={exportCsv}>Export CSV</button>
          <button onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <div className="stats">
        <div className="stat"><span className="label">VAT {net >= 0 ? 'payable' : 'refundable'}</span><strong className={net > 0 ? 'warn' : 'ok'}><Money value={Math.abs(net)} /></strong>
          <span className="muted small">output − credit notes − claimable input − withheld by clients</span></div>
        {levies.map((l) => <div key={l.component} className="stat"><span className="label">{l.component} payable</span><strong><Money value={l.net_payable} /></strong></div>)}
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Tax</th><th className="num">Output</th><th className="num">Credit notes</th><th className="num">Claimable input</th><th className="num">Withheld by clients</th><th className="num">Net</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">No taxed documents in this month.</td></tr>}
          {rows.map((r) => (
            <tr key={`${r.component}-${r.is_vat}`}><td>{r.component}{r.is_vat && <span className="muted small"> (VAT)</span>}</td>
              <td><Money value={r.output_tax} /></td><td><Money value={-r.credit_notes} /></td><td><Money value={-r.input_claimable} /></td>
              <td><Money value={-r.withheld_by_clients} /></td><td><Money value={r.net_payable} strong /></td></tr>
          ))}
        </tbody>
      </table></div>

      <h2>Output: invoices issued ({(invoices.data ?? []).length})</h2>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th className="num">Net</th><th className="num">VAT</th><th className="num">Levies</th></tr></thead>
        <tbody>{(invoices.data ?? []).map((i) => { const t = (i.lines ?? []).flatMap((l) => l.taxes ?? []); return (
          <tr key={i.id}><td><Link to={`/invoices/${i.invoice_number}`}>{i.invoice_number}</Link></td><td>{formatDate(i.invoice_date)}</td><td>{i.client?.name}</td>
            <td><Money value={i.net_total} /></td><td><Money value={sumTaxes(t, true)} /></td><td><Money value={sumTaxes(t, false)} /></td></tr>) })}
          {(invoices.data ?? []).length === 0 && <tr><td colSpan={6} className="muted">None.</td></tr>}</tbody>
      </table></div>

      {(credits.data ?? []).length > 0 && <>
        <h2>Less: credit notes</h2>
        <div className="table-wrap"><table className="compact">
          <thead><tr><th>Credit note</th><th>Date</th><th>Invoice</th><th className="num">Net</th><th className="num">VAT</th><th className="num">Levies</th></tr></thead>
          <tbody>{(credits.data ?? []).map((c) => (
            <tr key={c.id}><td>{c.cn_number}</td><td>{formatDate(c.cn_date)}</td><td>{c.invoice?.invoice_number}</td>
              <td><Money value={c.net_amount} /></td><td><Money value={sumTaxes(c.taxes, true)} /></td><td><Money value={sumTaxes(c.taxes, false)} /></td></tr>
          ))}</tbody>
        </table></div>
      </>}

      <h2>Less: claimable input tax ({claimable.length})</h2>
      <p className="muted small">Only expenses marked as having a valid VAT invoice, and only the recoverable components of their tax code.</p>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Date</th><th>Expense</th><th>Supplier</th><th className="num">Net</th><th className="num">VAT</th><th className="num">Other recoverable</th></tr></thead>
        <tbody>{claimable.map((x) => (
          <tr key={x.id}><td>{formatDate(x.expense_date)}</td><td>{x.description}</td><td>{x.supplier?.name ?? '—'}{x.tin && <span className="muted small"> TIN {x.tin}</span>}</td>
            <td><Money value={x.net_amount} /></td><td><Money value={x.vat} /></td><td><Money value={x.other} /></td></tr>
        ))}
        {claimable.length === 0 && <tr><td colSpan={6} className="muted">None.</td></tr>}</tbody>
      </table></div>

      {(withheld.data ?? []).length > 0 && <>
        <h2>Less: VAT withheld by clients</h2>
        <div className="table-wrap"><table className="compact">
          <thead><tr><th>Date</th><th>Client</th><th>Reference</th><th className="num">VAT withheld</th></tr></thead>
          <tbody>{(withheld.data ?? []).map((w) => (
            <tr key={w.id}><td>{formatDate(w.receipt_date)}</td><td>{w.client?.name}</td><td>{w.reference ?? '—'}</td><td><Money value={w.vat_withheld_amount} /></td></tr>
          ))}</tbody>
        </table></div>
      </>}
    </section>
  )
}
