import { useQuery } from '@tanstack/react-query'
import { formatDate, formatMoney } from '../../lib/format'
import { companyProfile, taxSummary, type Invoice, type InvoiceLine } from './api'

/** VAT-compliant tax invoice on the MeLiNS letterhead (brief §7.4). Print or "Save as PDF". */
export function InvoicePrint({ invoice, lines, onClose }: { invoice: Invoice; lines: InvoiceLine[]; onClose: () => void }) {
  const co = useQuery({ queryKey: ['company-profile'], queryFn: companyProfile })
  const c = co.data
  const draft = invoice.status === 'draft'
  const number = invoice.invoice_number ?? invoice.draft_ref
  const taxes = taxSummary(lines)
  const amountDue = Number(invoice.gross_total) - Number(invoice.retention_amount)

  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>
        <button onClick={onClose}>Close</button>
        {!c?.tin && <span className="form-error small">Company TIN and VAT number aren't set yet (setup wizard).</span>}
      </div>
      <article className="print-sheet">
        {draft && <div className="watermark">DRAFT: NOT A TAX INVOICE</div>}
        <header className="letterhead">
          <img src="/brand/melins-logo.jpg" alt="MeLiNS" />
          <div>
            <strong>{c?.registered_name ?? 'MeLiNS Associates Limited'}</strong>
            <div className="small">{c?.address}</div>
            <div className="small">TIN: {c?.tin ?? '—'} · VAT No: {c?.vat_number ?? '—'}</div>
            <div className="tagline">STRUCTURES · CIVILS · DEVELOPMENT CONSULTANTS</div>
          </div>
        </header>

        <h1 className="doc-title">TAX INVOICE</h1>
        <div className="doc-meta">
          <div>
            <div className="label">Bill to</div>
            <strong>{invoice.client?.name}</strong>
            {invoice.client?.organisation && <div>{invoice.client.organisation}</div>}
            {invoice.client?.tin && <div>TIN: {invoice.client.tin}</div>}
            {invoice.client?.vat_number && <div>VAT No: {invoice.client.vat_number}</div>}
          </div>
          <table className="meta"><tbody>
            <tr><td>Invoice no.</td><td><strong>{number}</strong></td></tr>
            <tr><td>Date</td><td>{formatDate(invoice.invoice_date)}</td></tr>
            <tr><td>Due</td><td>{formatDate(invoice.due_date)}</td></tr>
            <tr><td>Job</td><td>{invoice.job?.job_number}</td></tr>
            {invoice.gra_einvoice_ref && <tr><td>GRA e-invoice</td><td>{invoice.gra_einvoice_ref}</td></tr>}
          </tbody></table>
        </div>
        <p><strong>{invoice.job?.title}</strong></p>

        <table className="lines">
          <thead><tr><th>Description</th><th>Tax</th><th className="num">Amount (GHS)</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}><td>{l.description}</td><td>{l.tax_code?.name ?? 'No tax'}</td><td className="num">{formatMoney(l.net_amount, false)}</td></tr>
            ))}
          </tbody>
        </table>

        <table className="totals print-totals"><tbody>
          <tr><td>Net amount</td><td className="num">{formatMoney(invoice.net_total, false)}</td></tr>
          {taxes.map((t) => (
            <tr key={t.name}><td>{t.name}{t.rate !== null ? ` @ ${Math.round(t.rate * 100000) / 1000}%` : ''}</td><td className="num">{formatMoney(t.amount, false)}</td></tr>
          ))}
          <tr className="grand"><td>Total (VAT inclusive)</td><td className="num">{formatMoney(invoice.gross_total)}</td></tr>
          {Number(invoice.retention_amount) > 0 && <>
            <tr><td>Less retention ({invoice.retention_pct}%)</td><td className="num">({formatMoney(invoice.retention_amount, false)})</td></tr>
            <tr className="grand"><td>Amount due</td><td className="num">{formatMoney(amountDue)}</td></tr>
          </>}
        </tbody></table>

        <section className="pay-instructions">
          <h2>How to pay</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{c?.invoice_payment_details ?? 'Bank and mobile money details: to be set in the setup wizard.'}</p>
          <p>Please quote <strong>{number}</strong> as the payment reference.</p>
          <p>Send remittance advices and withholding tax certificates to <strong>{c?.accounts_email ?? 'accounts@themelins.com'}</strong>.</p>
        </section>
      </article>
    </div>
  )
}
