import { todayAccra } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export const INVOICE_LIST_SELECT =
  'id, invoice_number, draft_ref, invoice_date, due_date, status, ready_for_approval, net_total, gross_total, outstanding, is_imported, job:jobs(job_number, title), client:clients(name)'

export async function listInvoices() {
  const { data, error } = await supabase.from('invoices').select(INVOICE_LIST_SELECT)
    .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
  if (error) throw error
  return data
}
export type InvoiceListRow = Awaited<ReturnType<typeof listInvoices>>[number]

/** A URL key is an issued number (INV-2026-014) or a draft reference (DRAFT-7f3a). */
export function safeKey(key: string): string {
  if (!/^[A-Za-z0-9-]{1,40}$/.test(key)) throw new Error('Not an invoice reference')
  return key
}

export async function getInvoice(key: string) {
  const k = safeKey(key)
  const { data, error } = await supabase.from('invoices')
    .select('*, job:jobs(id, job_number, title, retention_pct), client:clients(id, name, organisation, tin, vat_number, email, phone)')
    .or(`invoice_number.eq.${k},draft_ref.eq.${k}`).maybeSingle()
  if (error) throw error
  return data
}
export type Invoice = NonNullable<Awaited<ReturnType<typeof getInvoice>>>

export async function getInvoiceLines(invoiceId: string) {
  const { data, error } = await supabase.from('invoice_lines')
    .select('*, taxes:invoice_line_taxes(seq, name, rate, amount, is_vat), milestone:billing_milestones(name), tax_code:tax_codes(name)')
    .eq('invoice_id', invoiceId).order('seq').order('created_at')
  if (error) throw error
  return data
}
export type InvoiceLine = Awaited<ReturnType<typeof getInvoiceLines>>[number]

export async function getCreditNotes(invoiceId: string) {
  const { data, error } = await supabase.from('credit_notes').select('*').eq('invoice_id', invoiceId).order('created_at')
  if (error) throw error
  return data
}

export async function getPayments(invoiceId: string) {
  const { data, error } = await supabase.from('receipt_allocations')
    .select('id, cash_amount, wht_amount, vat_withheld_amount, receipt:receipts(id, receipt_date, status, method, reference, source)')
    .eq('invoice_id', invoiceId)
  if (error) throw error
  return data
}

/** VAT and levies across all lines, one row per component. */
export function taxSummary(lines: InvoiceLine[]) {
  const map = new Map<string, { name: string; rate: number | null; amount: number; seq: number }>()
  for (const l of lines) {
    for (const t of l.taxes ?? []) {
      const cur = map.get(t.name)
      if (cur) {
        cur.amount += Number(t.amount)
        if (cur.rate !== Number(t.rate)) cur.rate = null
      } else map.set(t.name, { name: t.name, rate: Number(t.rate), amount: Number(t.amount), seq: t.seq })
    }
  }
  return [...map.values()].sort((a, b) => a.seq - b.seq)
}

export async function accountantMayApprove(): Promise<boolean> {
  const { data } = await supabase.from('settings_versions').select('accountant_may_approve_invoices, effective_from')
    .lte('effective_from', todayAccra()).order('effective_from', { ascending: false }).limit(1).maybeSingle()
  return Boolean(data?.accountant_may_approve_invoices)
}

export async function companyProfile() {
  const { data } = await supabase.from('company_profile').select('*').maybeSingle()
  return data
}
