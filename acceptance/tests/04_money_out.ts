// Brief §13 items 15, 16, 17, 18, 19, 24, 26, 27 (and D-010, D-016, D-017).
import { describe, expect, test } from 'vitest'
import { adminSql } from '../lib/staging'
import { as, fx, ok, one, rejected, staffId, userId } from '../lib/session'
import { addMonths, cat, ctx, monthStart } from '../lib/ctx'

const monthLine = async (type: string) => {
  const owner = await as('owner')
  const rows = await ok(owner.from('statutory_lines').select('amount_due').eq('type', type).eq('period_start', monthStart(fx().today)).eq('is_opening_arrears', false))
  return rows!.reduce((s, r) => s + Number(r.amount_due), 0)
}
const vatRow = async () => {
  const owner = await as('owner')
  const rows = await ok<any[]>(owner.rpc('vat_workings', { p_month: fx().today }))
  const v = rows!.find(r => r.component === 'VAT') ?? {}
  const levies = rows!.filter(r => ['NHIL', 'GETFund'].includes(r.component)).reduce((s, r) => s + Number(r.output_tax), 0)
  return { output: Number(v.output_tax ?? 0), credit: Number(v.credit_notes ?? 0), input: Number(v.input_claimable ?? 0), net: Number(v.net_payable ?? 0), levies }
}

describe('Money out, statutory, VAT and directors', () => {
  test('15 · A supplier payment needs the Owner\'s approval and can\'t exceed what\'s owed', async () => {
    const whtBefore = await monthLine('wht_remittance')
    const admin = await as('admin')
    const bill = await one(admin.from('expenses').insert({
      expense_date: fx().today, category_id: await cat('Sublet work'), job_id: ctx.jobs.office, supplier_id: ctx.supplier,
      description: 'ACC CAD drafting, set A', amount: 2000, payment_source: 'supplier_payable',
    }).select('id'), 'bill')
    const pay = await one(admin.from('payments_out').insert({ supplier_id: ctx.supplier, description: 'ACC Kojo CAD for set A' }).select('id'))
    expect(await rejected(admin.from('payment_out_items').insert({ payment_out_id: pay.id, expense_id: bill.id, amount: 2500 })), 'overpay').toMatch(/more than is owed/)
    await ok(admin.from('payment_out_items').insert({ payment_out_id: pay.id, expense_id: bill.id, amount: 2000 }))
    const p = await one(admin.from('payments_out').select('gross_amount, wht_amount, net_amount').eq('id', pay.id))
    expect([Number(p.gross_amount), Number(p.wht_amount), Number(p.net_amount)], 'gross, WHT 7.5%, net').toEqual([2000, 150, 1850])
    const paid = { status: 'paid', payment_date: fx().today, account_id: ctx.accounts.bank, method: 'cheque', reference: 'ACC CHQ 001' }
    expect(await rejected(admin.from('payments_out').update(paid).eq('id', pay.id)), 'paid before approval').toMatch(/cannot move from prepared to paid/)
    expect(await rejected(admin.from('payments_out').update({ status: 'approved' }).eq('id', pay.id)), 'admin approves').toMatch(/Only the Owner approves/)
    const acct = await as('accountant')
    expect(await rejected(acct.from('payments_out').update({ status: 'approved' }).eq('id', pay.id)), 'accountant approves').toMatch(/Only the Owner approves/)
    const owner = await as('owner')
    await ok(owner.from('payments_out').update({ status: 'approved' }).eq('id', pay.id), 'owner approves')
    expect((await ok(admin.from('action_items').select('id').eq('kind', 'pay_approved').eq('status', 'open').eq('record_id', pay.id)))!.length, 'admin "pay" task').toBe(1)
    expect(await rejected(admin.from('payment_out_items').update({ amount: 1000 }).eq('payment_out_id', pay.id)), 'approved amount').toMatch(/fixed/)
    await ok(admin.from('payments_out').update(paid).eq('id', pay.id), 'mark paid')
    expect(await rejected(admin.from('payments_out').update({ reference: 'changed' }).eq('id', pay.id)), 'paid is locked').toMatch(/locked/)
    expect((await ok(admin.from('supplier_bills_open').select('*').eq('expense_id', bill.id)))!.length, 'bill no longer open').toBe(0)
    expect(await monthLine('wht_remittance') - whtBefore, 'WHT goes to this month\'s remittance line').toBe(150)
    expect(Number((await one(owner.from('ledger_entries').select('amount').eq('source_id', pay.id))).amount), 'net leaves the account').toBe(-1850)
  })

  test('16 · An out-of-pocket claim goes Owed → Approved → Reimbursed, once; a recharge is billed once', async () => {
    const eng = await as('engineer')
    const claim = await one(eng.from('expenses').insert({
      expense_date: fx().today, category_id: await cat('Testing and lab fees'), job_id: ctx.jobs.office, description: 'ACC Concrete cube tests',
      amount: 600, payment_source: 'staff_out_of_pocket', staff_id: staffId('ACC Engineer'), rechargeable: true, recharge_markup_pct: 10,
    }).select('id, reimbursement_status'), 'claim')
    ctx.invoices.claim = claim.id
    expect(claim.reimbursement_status).toBe('owed')
    expect(await rejected(eng.from('expenses').update({ reimbursement_status: 'approved' }).eq('id', claim.id)), 'approve own').toMatch(/not this person's approver/)
    expect(await rejected(eng.from('expenses').insert({ expense_date: fx().today, category_id: await cat('Rent'), description: 'ACC x', amount: 1, payment_source: 'company_account' })),
      'staff posting a company expense').toMatch(/own out-of-pocket/)
    const lead = await as('lead')
    await ok(lead.from('expenses').update({ reimbursement_status: 'approved' }).eq('id', claim.id), 'lead approves')

    const admin = await as('admin')
    const sp = await one(admin.from('staff_payments').insert({ staff_id: staffId('ACC Engineer') }).select('id'))
    await ok(admin.from('expenses').update({ staff_payment_id: sp.id }).eq('id', claim.id), 'add to payment')
    expect(Number((await one(admin.from('staff_payments').select('amount').eq('id', sp.id))).amount)).toBe(600)
    const owner = await as('owner')
    await ok(owner.from('staff_payments').update({ status: 'approved' }).eq('id', sp.id), 'owner approves')
    await ok(admin.from('staff_payments').update({ status: 'paid', payment_date: fx().today, method: 'mobile_money', account_id: ctx.accounts.momo }).eq('id', sp.id), 'paid')
    expect((await one(owner.from('expenses').select('reimbursement_status').eq('id', claim.id))).reimbursement_status).toBe('reimbursed')
    const sp2 = await one(admin.from('staff_payments').insert({ staff_id: staffId('ACC Engineer') }).select('id'))
    expect(await rejected(admin.from('expenses').update({ staff_payment_id: sp2.id }).eq('id', claim.id)), 'reimbursed twice').not.toBe('')
    expect(await rejected(admin.from('expenses').update({ amount: 1 }).eq('id', claim.id)), 'reimbursed claim is locked').not.toBe('')

    const inv = await one(admin.from('invoices').insert({ job_id: ctx.jobs.office, invoice_date: fx().today, notes: 'ACC recharge' }).select('id'))
    const offered = await ok(admin.from('ready_to_invoice').select('*').eq('item_type', 'rechargeable_expense').eq('job_id', ctx.jobs.office))
    expect(offered!.length, 'offered for the next invoice').toBe(1)
    const line = await one(admin.from('invoice_lines').insert({ invoice_id: inv.id, line_type: 'rechargeable_expense', description: 'Recharge: cube tests', expense_id: claim.id, net_amount: null }).select('net_amount'))
    expect(Number(line.net_amount), 'cost + 10%').toBe(660)
    expect(await rejected(admin.from('invoice_lines').insert({ invoice_id: inv.id, line_type: 'rechargeable_expense', description: 'again', expense_id: claim.id, net_amount: null })),
      'billed twice').toMatch(/duplicate key/)
  })

  test('D-010 · The Owner\'s own reimbursement needs Accountant review and both Directors are told', async () => {
    const owner = await as('owner')
    const e = await one(owner.from('expenses').insert({ expense_date: fx().today, category_id: await cat('Fuel'), description: 'ACC Fuel to client meeting', amount: 300,
      payment_source: 'staff_out_of_pocket', staff_id: staffId('ACC Owner') }).select('id'))
    await ok(owner.from('expenses').update({ reimbursement_status: 'approved' }).eq('id', e.id))
    const acct = await as('accountant')
    const sp = await one(acct.from('staff_payments').insert({ staff_id: staffId('ACC Owner') }).select('id, is_to_owner'))
    expect(sp.is_to_owner).toBe(true)
    await ok(acct.from('expenses').update({ staff_payment_id: sp.id }).eq('id', e.id))
    await ok(owner.from('staff_payments').update({ status: 'approved' }).eq('id', sp.id))
    expect((await one(owner.from('staff_payments').select('review_status').eq('id', sp.id))).review_status).toBe('recorded')
    for (const d of ['director1', 'director2'] as const) {
      const c = await as(d)
      expect((await ok(c.from('notifications').select('id').eq('kind', 'payment_to_owner').eq('record_id', sp.id)))!.length, `${d} told`).toBe(1)
    }
  })

  test('17 · Statutory arrears show separately for PAYE, Tier 1 and Tier 2, with payee and due date; overdue lines are red', async () => {
    const acct = await as('accountant')
    const m = monthStart(fx().today)
    const rows = await ok(acct.from('statutory_lines').insert([
      { type: 'paye', amount_due: 30000, is_opening_arrears: true, notes: 'ACC opening arrears' },
      { type: 'ssnit_tier1', amount_due: 15000, is_opening_arrears: true, notes: 'ACC opening arrears' },
      { type: 'ssnit_tier2', amount_due: 7500, is_opening_arrears: true, notes: 'ACC opening arrears' },
      { type: 'paye', period_start: '2019-03-01', amount_due: 1000, notes: 'ACC old' },
      { type: 'paye', period_start: m, amount_due: 1000, notes: 'ACC current' },
    ], { defaultToNull: false }).select('id, type, notes'), 'lines')
    const ids = rows!.map(r => r.id)
    const led = await ok(acct.from('statutory_ledger').select('*').in('id', ids))
    const arrears = led!.filter(l => l.is_opening_arrears)
    expect(arrears.map(l => l.type).sort()).toEqual(['paye', 'ssnit_tier1', 'ssnit_tier2'])
    expect(arrears.every(l => l.status === 'overdue'), 'arrears overdue').toBe(true)
    expect(arrears.find(l => l.type === 'ssnit_tier1').payee).toBe('SSNIT')
    expect(led!.find(l => l.notes === 'ACC old').status, 'unpaid past its due date').toBe('overdue')
    const cur = led!.find(l => l.notes === 'ACC current')
    expect(cur.status).toBe('due')
    expect(cur.due_date, 'PAYE due the 15th of next month').toBe(`${addMonths(m, 1).slice(0, 7)}-15`)

    const payeArrears = rows!.find(r => r.type === 'paye' && r.notes === 'ACC opening arrears')!.id
    const sp = await one(acct.from('statutory_payments').insert({ statutory_line_id: payeArrears, amount: 5000 }).select('id'))
    expect(await rejected(acct.from('statutory_payments').update({ status: 'approved' }).eq('id', sp.id)), 'D-016 accountant approves').toMatch(/Only the Owner/)
    const owner = await as('owner')
    await ok(owner.from('statutory_payments').update({ status: 'approved' }).eq('id', sp.id))
    await ok(acct.from('statutory_payments').update({ status: 'paid', payment_date: fx().today, reference: 'ACC GRA-1', account_id: ctx.accounts.bank }).eq('id', sp.id))
    expect(Number((await one(acct.from('statutory_ledger').select('outstanding').eq('id', payeArrears))).outstanding), 'D-016 payment reduces arrears').toBe(25000)
  })

  test('18 · VAT workings = output VAT − credit notes − claimable input VAT', async () => {
    const before = await vatRow()
    const owner = await as('owner')
    const inv = await one(owner.from('invoices').insert({ job_id: ctx.jobs.office, invoice_date: fx().today, notes: 'ACC vat-test' }).select('id'))
    await ok(owner.from('invoice_lines').insert({ invoice_id: inv.id, description: 'Stage 2 design fee', tax_code_id: ctx.tax.standard, net_amount: 20000 }))
    await ok(owner.from('invoices').update({ status: 'approved' }).eq('id', inv.id))
    const cn = await one(owner.from('credit_notes').insert({ invoice_id: inv.id, reason: 'ACC scope reduced', tax_code_id: ctx.tax.standard, net_amount: 5000 }).select('id'))
    await ok(owner.from('credit_notes').update({ status: 'approved' }).eq('id', cn.id))
    expect((await one(owner.from('credit_notes').select('cn_number').eq('id', cn.id))).cn_number).toMatch(/^CN-\d{4}-\d{3}$/)
    expect(Number((await one(owner.from('invoices').select('credited_total').eq('id', inv.id))).credited_total), 'credit note reduces the invoice').toBe(6000)
    await ok(owner.from('expenses').insert([
      { expense_date: fx().today, category_id: await cat('Software licences and subscriptions'), description: 'ACC analysis software', amount: 1200,
        payment_source: 'company_account', account_id: ctx.accounts.bank, tax_code_id: ctx.tax.standard, has_valid_vat_invoice: true },
      { expense_date: fx().today, category_id: await cat('Printing and plotting'), description: 'ACC plotting, no VAT invoice', amount: 600,
        payment_source: 'company_account', account_id: ctx.accounts.bank, tax_code_id: ctx.tax.standard, has_valid_vat_invoice: false },
    ], { defaultToNull: false }))
    const after = await vatRow()
    expect(after.output - before.output, 'output VAT (20% of 20,000)').toBe(4000)
    expect(after.credit - before.credit, 'less credit notes').toBe(1000)
    expect(after.input - before.input, 'input VAT only with a valid VAT invoice (1,200 at 20%, VAT-inclusive)').toBe(200)
    expect(Math.round((after.net - before.net) * 100) / 100, 'net').toBe(2800)
  })

  test('19 · A director\'s loan raises cash and "company owes director", not income', async () => {
    const dir = fx().directors['ACC Director Two']
    const acct = await as('accountant')
    const t = await one(acct.from('director_transactions').insert({ director_id: dir, txn_date: fx().today, type: 'loan_in', amount: 20000, account_id: ctx.accounts.bank, description: 'ACC short-term loan' }).select('id'))
    const owner = await as('owner')
    expect(Number((await one(owner.from('director_balances').select('balance').eq('id', dir))).balance)).toBe(20000)
    const le = await ok(owner.from('ledger_entries').select('amount, account_id').eq('source_id', t.id))
    expect(Number(le!.find(l => l.account_id === ctx.accounts.bank)!.amount), 'account up 20,000').toBe(20000)
    const d2 = await as('director2')
    expect(Number((await one(d2.from('director_balances').select('balance').eq('id', dir))).balance), 'director sees own balance').toBe(20000)
    await ok(owner.from('director_hidden_areas').update({ hidden: true }).eq('area', 'other_director_accounts'))
    try {
      expect((await ok(d2.from('director_balances').select('id')))!.map(r => r.id), 'D-017 only own account').toEqual([dir])
      const d1 = await as('director1')
      expect((await ok(d1.from('director_transactions').select('id').eq('director_id', dir)))!.length, 'D-017 others hidden').toBe(0)
    } finally {
      await ok(owner.from('director_hidden_areas').update({ hidden: false }).eq('area', 'other_director_accounts'))
    }
  })

  test('24 · A director\'s fee needs Owner approval, deducts tax, is a Directors\' fee and creates the statutory line', async () => {
    const lineBefore = await monthLine('wht_directors_dividends')
    const acct = await as('accountant')
    const p = await one(acct.from('director_payments').insert({ director_id: fx().directors['ACC Director One'], payment_type: 'fee_or_allowance', gross_amount: 5000 })
      .select('id, tax_amount, category_id'), 'fee')
    expect(Number(p.tax_amount), 'tax at the configured 20%').toBe(1000)
    expect(p.category_id).toBe(await cat("Directors' fees and allowances"))
    expect(await rejected(acct.from('director_payments').update({ status: 'approved' }).eq('id', p.id)), 'accountant approves').toMatch(/Only the Owner/)
    const owner = await as('owner')
    await ok(owner.from('director_payments').update({ status: 'approved' }).eq('id', p.id))
    await ok(owner.from('director_payments').update({ status: 'paid', payment_date: fx().today, account_id: ctx.accounts.bank }).eq('id', p.id))
    expect(await monthLine('wht_directors_dividends') - lineBefore, 'statutory line').toBe(1000)
    expect(Number((await one(owner.from('ledger_entries').select('amount').eq('source_id', p.id))).amount), 'net paid').toBe(-4000)
  })

  test('27 · A monthly "Cleaner" recurring expense makes one draft a month, under Office running › Cleaning services', async () => {
    const owner = await as('owner')
    ctx.recurringBefore = Number((await ok<any>(owner.rpc('running_cost')))?.recurring ?? 0)
    const admin = await as('admin')
    const rec = await one(admin.from('recurring_expenses').insert({ name: 'ACC Cleaner', category_id: await cat('Cleaning services'), expected_amount: 800,
      frequency: 'monthly', next_due_date: monthStart(fx().today), account_id: ctx.accounts.petty }).select('id'))
    adminSql(`select app.generate_recurring_drafts(app.today()); select app.generate_recurring_drafts(app.today());`)  // the daily job, run twice
    const drafts = await ok(owner.from('expenses').select('id, entry_status').eq('description', 'ACC Cleaner'))
    expect(drafts!.length, 'one draft per due date').toBe(1)
    expect(drafts![0].entry_status).toBe('draft')
    expect((await ok(owner.from('ledger_entries').select('id').eq('source_id', drafts![0].id)))!.length, 'drafts move no cash').toBe(0)
    await ok(admin.from('expenses').update({ entry_status: 'confirmed' }).eq('id', drafts![0].id), 'confirm')
    const e = await one(owner.from('expenses').select('category:expense_categories(name, parent:expense_categories(name))').eq('id', drafts![0].id))
    expect(`${e.category.parent?.name} > ${e.category.name}`).toBe('Office running > Cleaning services')
    expect((await one(owner.from('recurring_expenses').select('next_due_date').eq('id', rec.id))).next_due_date, 'next due a month on').toBe(addMonths(monthStart(fx().today), 1))
  })

  test('26 · The running cost is calculated from payroll and recurring expenses, with the Owner\'s override alongside', async () => {
    const owner = await as('owner')
    const rc = await ok<any>(owner.rpc('running_cost'))
    expect(Number(rc.recurring) - ctx.recurringBefore, 'includes the 800 recurring').toBe(800)
    const latest = await one(owner.from('settings_versions').select('*').lte('effective_from', fx().today).order('effective_from', { ascending: false }).limit(1))
    const { id: _id, created_at: _c, created_by: _b, ...copy } = latest
    const v = await one(owner.from('settings_versions').insert({ ...copy, effective_from: fx().today, running_cost_override: 50000, notes: 'ACC override' }).select('id'))
    ctx.todaySettingsId = v.id
    const after = await ok<any>(owner.rpc('running_cost'))
    expect(Number(after.override)).toBe(50000)
    expect(after.calculated, 'calculated still shown').not.toBeNull()
    expect((await ok<any>(owner.rpc('money_panel')))?.weeks_of_cover, 'money panel weeks of cover').not.toBeUndefined()
  })
})
