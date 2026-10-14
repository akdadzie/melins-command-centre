// Brief §13 items 6, 7, 8, 9, 10, 12, 23: invoices and money in.
import { describe, expect, test } from 'vitest'
import { as, fx, ok, one, rejected } from '../lib/session'
import { addDays, ctx } from '../lib/ctx'

const balances = async () => {
  const owner = await as('owner')
  const rows = await ok(owner.from('account_balances').select('id, calculated_balance').in('id', Object.values(ctx.accounts)))
  const by = Object.fromEntries(rows!.map(r => [r.id, Number(r.calculated_balance)]))
  return { bank: by[ctx.accounts.bank], momo: by[ctx.accounts.momo], petty: by[ctx.accounts.petty], total: rows!.reduce((s, r) => s + Number(r.calculated_balance), 0) }
}
const seq = (n: string) => Number(n.split('-').pop())

describe('Invoices and money in', () => {
  test('6 · Admin drafts, only the Owner approves, and numbers come on approval with no gaps', async () => {
    const admin = await as('admin')
    const inv = await one(admin.from('invoices').insert({ job_id: ctx.jobs.office, invoice_date: fx().today }).select('id, invoice_number, draft_ref'), 'draft')
    ctx.invoices.main = inv.id
    expect(inv.invoice_number, 'no number while a draft').toBeNull()
    expect(inv.draft_ref).toMatch(/^DRAFT-/)
    await ok(admin.from('invoice_lines').insert({ invoice_id: inv.id, description: 'Stage 1 design fee', tax_code_id: ctx.tax.standard, net_amount: 100000 }), 'line')
    expect(await rejected(admin.from('invoices').update({ status: 'approved' }).eq('id', inv.id)), 'admin approves').toMatch(/Only the Owner approves/)
    expect(await rejected(admin.from('invoices').update({ status: 'sent' }).eq('id', inv.id)), 'draft sent').toMatch(/cannot move from draft to sent/)
    await ok(admin.from('invoices').update({ ready_for_approval: true }).eq('id', inv.id), 'ready for approval')

    const owner = await as('owner')
    const notes = await ok(owner.from('notifications').select('id').eq('kind', 'approval_needed').eq('record_id', inv.id))
    expect(notes!.length, 'Owner notified a draft is ready').toBe(1)
    await ok(owner.from('invoices').update({ status: 'approved' }).eq('id', inv.id), 'approve')

    const second = await one(owner.from('invoices').insert({ job_id: ctx.jobs.office, invoice_date: fx().today, notes: 'ACC rolled back' }).select('id'))
    ctx.invoices.second = second.id
    expect(await rejected(owner.from('invoices').update({ status: 'approved' }).eq('id', second.id)), 'approval without lines').toMatch(/at least one line/)
    await ok(owner.from('invoice_lines').insert({ invoice_id: second.id, description: 'Additional site visit', tax_code_id: ctx.tax.noVat, net_amount: 5000 }))
    await ok(owner.from('invoices').update({ status: 'approved' }).eq('id', second.id), 'approve second')

    const nums = await ok(owner.from('invoices').select('id, invoice_number').in('id', [inv.id, second.id]))
    const n1 = nums!.find(r => r.id === inv.id)!.invoice_number as string
    const n2 = nums!.find(r => r.id === second.id)!.invoice_number as string
    expect(n1, 'format').toMatch(new RegExp(`^INV-${fx().today.slice(0, 4)}-\\d{3}$`))
    expect(seq(n2), 'the failed approval left no gap').toBe(seq(n1) + 1)
    expect(await rejected(owner.from('invoice_lines').update({ net_amount: 1 }).eq('invoice_id', inv.id)), 'issued lines').toMatch(/locked/)
    expect(await rejected(owner.from('invoices').update({ due_date: addDays(fx().today, 60) }).eq('id', inv.id)), 'issued invoice').toMatch(/locked/)
  })

  test('7 · VAT and levies follow the tax code in force; a later rate change leaves issued invoices alone', async () => {
    const owner = await as('owner')
    const i = await one(owner.from('invoices').select('tax_total, gross_total').eq('id', ctx.invoices.main))
    expect(Number(i.tax_total), 'NHIL 2,500 + GETFund 2,500 + VAT 15% of 105,000').toBe(20750)
    expect(Number(i.gross_total)).toBe(120750)
    const acct = await as('accountant')
    const v = await one(acct.from('tax_code_versions').insert({ tax_code_id: ctx.tax.standard, effective_from: fx().today, vat_withholding_rate: 0.4667 }).select('id'))
    await ok(acct.from('tax_code_components').insert({ version_id: v.id, seq: 1, name: 'VAT', rate: 0.2, basis: 'net', recoverable: true, is_vat: true }))
    const after = await one(owner.from('invoices').select('tax_total').eq('id', ctx.invoices.main))
    expect(Number(after.tax_total), 'issued invoice unchanged').toBe(20750)
  })

  test('9 · 10% retention on a GHS 100,000 invoice, with the job\'s retention balance and release date', async () => {
    const owner = await as('owner')
    const i = await one(owner.from('invoices').select('retention_amount, expected_wht').eq('id', ctx.invoices.main))
    expect(Number(i.retention_amount)).toBe(10000)
    expect(Number(i.expected_wht), '8: expected WHT on the VAT-exclusive amount').toBe(7500)
    await ok(owner.from('jobs').update({ retention_release_date: addDays(fx().today, 365), retention_release_terms: '12 months after completion' }).eq('id', ctx.jobs.office))
    const admin = await as('admin')
    const r = await one(admin.from('retention_by_job').select('*').eq('job_id', ctx.jobs.office))
    expect(Number(r.retention_held), 'retention list: 10,000 + 500 on the second invoice').toBe(10500)
  })

  test('8 · Cash plus WHT settles the invoice and creates an Expected WHT certificate, flagged after 30 days', async () => {
    const admin = await as('admin')
    await ok(admin.from('invoices').update({ status: 'sent' }).eq('id', ctx.invoices.main), 'sent')
    const r = await one(admin.from('receipts').insert({
      client_id: ctx.clients.acme, receipt_date: fx().today, cash_amount: 103250, wht_amount: 7500, account_id: ctx.accounts.bank,
      method: 'bank_transfer', reference: 'ACC-TT123', source: 'remittance_advice',
    }).select('id'), 'receipt')
    ctx.invoices.mainReceipt = r.id
    await ok(admin.from('receipt_allocations').insert({ receipt_id: r.id, invoice_id: ctx.invoices.main, cash_amount: 103250, wht_amount: 7500 }), 'allocation')
    const owner = await as('owner')
    expect((await one(owner.from('invoices').select('status').eq('id', ctx.invoices.main))).status, '120,750 less 10,000 retention, paid').toBe('paid')
    const cert = await one(owner.from('wht_certificates').select('status, expected_by, amount').eq('client_id', ctx.clients.acme))
    expect(Number(cert.amount)).toBe(7500)
    expect(cert.status).toBe('expected')
    expect(cert.expected_by).toBe(addDays(fx().today, 30))
  })

  test('10 · An Owner quick-log is "reported", gives Admin a task and isn\'t cash until the Accountant confirms', async () => {
    const owner = await as('owner')
    const id = await ok<string>(owner.rpc('quick_log_payment', { p_amount: 4500, p_date: fx().today, p_invoice_id: ctx.invoices.second }), 'quick log')
    ctx.invoices.quickReceipt = id
    const r = await one(owner.from('receipts').select('status, source').eq('id', id))
    expect(r.status).toBe('reported')
    expect(r.source).toBe('reported_by_owner')
    expect((await one(owner.from('invoices').select('status').eq('id', ctx.invoices.second))).status, 'settles the invoice').toBe('paid')
    expect((await ok(owner.from('ledger_entries').select('id').eq('source_id', id)))!.length, 'not cash yet').toBe(0)

    const admin = await as('admin')
    const tasks = await ok(admin.from('action_items').select('id').eq('kind', 'complete_reported_payment').eq('status', 'open').eq('record_id', id))
    expect(tasks!.length, 'Admin has a task').toBe(1)
    await ok(admin.from('receipts').update({ account_id: ctx.accounts.momo, method: 'mobile_money', reference: 'ACC-MOMO-9' }).eq('id', id), 'admin completes')
    const still = await ok(admin.from('action_items').select('id').eq('kind', 'complete_reported_payment').eq('status', 'open').eq('record_id', id))
    expect(still!.length, 'task closes once complete').toBe(0)
    expect(await rejected(admin.from('receipts').update({ status: 'confirmed' }).eq('id', id)), 'admin confirms').toMatch(/Only the Accountant.*confirms/)

    const acct = await as('accountant')
    await ok(acct.from('receipts').update({ status: 'confirmed' }).in('id', [id, ctx.invoices.mainReceipt]), 'confirm')
    expect((await ok(owner.from('ledger_entries').select('id').eq('source_id', id)))!.length, 'cash once confirmed').toBeGreaterThan(0)
  })

  test('12 · Receipt, expense and transfer move the right balances; a transfer leaves total cash unchanged', async () => {
    const b = await balances()
    expect(b.bank, 'bank = opening 10,000 + 103,250 - admin expense 250').toBe(10000 + 103250 - 250)
    expect(b.momo, 'MoMo = confirmed quick-logged 4,500').toBe(4500)
    const admin = await as('admin')
    const t = await one(admin.from('transfers').insert({ transfer_date: fx().today, from_account_id: ctx.accounts.momo, to_account_id: ctx.accounts.bank, amount: 4000, reason: 'ACC sweep' }).select('id'))
    expect((await ok(admin.from('transfers').select('id').eq('id', t.id)))!.length, 'admin sees own transfer').toBe(1)
    const a = await balances()
    expect(a.momo).toBe(500)
    expect(a.bank).toBe(b.bank + 4000)
    expect(a.total, 'total cash unchanged').toBe(b.total)
  })

  test('23 · A client payment received by a director settles the invoice, is owed by the director and isn\'t cash until handed over', async () => {
    const owner = await as('owner')
    const dir = fx().directors['ACC Director One']
    const inv = await one(owner.from('invoices').insert({ job_id: ctx.jobs.house, invoice_date: fx().today, notes: 'ACC director-paid' }).select('id'))
    await ok(owner.from('invoice_lines').insert({ invoice_id: inv.id, description: 'Consultation', tax_code_id: ctx.tax.noVat, net_amount: 5000 }))
    await ok(owner.from('invoices').update({ status: 'approved' }).eq('id', inv.id), 'approve')
    const before = await balances()
    const r = await one(owner.from('receipts').insert({
      client_id: ctx.clients.private, receipt_date: fx().today, cash_amount: 5000, method: 'cash', source: 'received_by_director', received_by_director_id: dir,
    }).select('id'), 'receipt')
    expect(await rejected(owner.from('receipt_allocations').insert({ receipt_id: r.id, invoice_id: inv.id, cash_amount: 5000.01 })), 'over-allocation').toMatch(/more than/)
    await ok(owner.from('receipt_allocations').insert({ receipt_id: r.id, invoice_id: inv.id, cash_amount: 5000 }))
    const acct = await as('accountant')
    await ok(acct.from('receipts').update({ status: 'confirmed' }).eq('id', r.id), 'confirm')
    expect((await one(owner.from('invoices').select('status').eq('id', inv.id))).status).toBe('paid')
    expect(Number((await one(owner.from('director_balances').select('balance').eq('id', dir))).balance), 'director owes 5,000').toBe(-5000)
    expect((await balances()).total, 'not MeLiNS cash').toBe(before.total)

    const admin = await as('admin')
    expect(await rejected(admin.from('transfers').insert({ transfer_date: fx().today, from_director_id: dir, to_account_id: ctx.accounts.bank, amount: 1 })),
      'admin records a hand-over').toMatch(/Only the Owner or Accountant records a director/)
    await ok(owner.from('transfers').insert({ transfer_date: fx().today, from_director_id: dir, to_account_id: ctx.accounts.bank, amount: 5000, reason: 'ACC hand-over' }))
    expect(Number((await one(owner.from('director_balances').select('balance').eq('id', dir))).balance), 'cleared').toBe(0)
    expect((await balances()).total, 'now counts as cash').toBe(before.total + 5000)
  })
})
