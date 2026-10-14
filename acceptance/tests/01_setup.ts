// The Owner and Accountant set up what the other sections use: accounts, tax
// codes, WHT rates, clients, a supplier and jobs. All named "ACC ...".
import { describe, expect, test } from 'vitest'
import { as, fx, ok, one, staffId } from '../lib/session'
import { ctx } from '../lib/ctx'

describe('Set-up through the app (Owner and Accountant)', () => {
  test('everyone can sign in; Owner, Directors and Accountant with an authenticator code', async () => {
    for (const who of ['owner', 'director1', 'director2', 'accountant', 'admin', 'lead', 'engineer', 'engineer2', 'nsp'] as const) {
      const c = await as(who)
      const { data } = await c.auth.getSession()
      expect(data.session?.user.email, who).toContain(`acc-${who}@`)
    }
  })

  test('Owner adds accounts', async () => {
    const owner = await as('owner')
    const rows = await ok(owner.from('accounts').insert([
      { name: 'ACC Bank', type: 'bank', purpose: 'operating', opening_balance: 10000, opening_date: '2019-01-01', admin_may_post: true, last4: '1234' },
      { name: 'ACC MoMo', type: 'mobile_money', purpose: 'collections', opening_balance: 0, opening_date: '2019-01-01', admin_may_post: true },
      { name: 'ACC Petty cash', type: 'petty_cash', purpose: 'petty_cash', opening_balance: 500, opening_date: '2019-01-01', admin_may_post: true },
      { name: 'ACC Reserve', type: 'bank', purpose: 'reserve', opening_balance: 0, opening_date: '2019-01-01', admin_may_post: false, last4: '9876' },
    ], { defaultToNull: false }).select('id, name'), 'insert accounts')
    const id = (n: string) => rows!.find(r => r.name === n)!.id
    ctx.accounts = { bank: id('ACC Bank'), momo: id('ACC MoMo'), petty: id('ACC Petty cash'), reserve: id('ACC Reserve') }
  })

  test('Accountant adds tax codes (NHIL, GETFund, VAT) and WHT rates', async () => {
    const acct = await as('accountant')
    const codes = await ok(acct.from('tax_codes').insert([
      { name: 'ACC Standard', kind: 'standard' }, { name: 'ACC No VAT', kind: 'no_vat' },
    ], { defaultToNull: false }).select('id, name'), 'insert tax codes')
    ctx.tax = { standard: codes!.find(c => c.name === 'ACC Standard')!.id, noVat: codes!.find(c => c.name === 'ACC No VAT')!.id }
    const std = await one(acct.from('tax_code_versions').insert({ tax_code_id: ctx.tax.standard, effective_from: '2019-01-01', vat_withholding_rate: 0.4667 }).select('id'), 'version')
    await ok(acct.from('tax_code_components').insert([
      { version_id: std.id, seq: 1, name: 'NHIL', rate: 0.025, basis: 'net', recoverable: false, is_vat: false },
      { version_id: std.id, seq: 2, name: 'GETFund', rate: 0.025, basis: 'net', recoverable: false, is_vat: false },
      { version_id: std.id, seq: 3, name: 'VAT', rate: 0.15, basis: 'net_plus_prior', recoverable: true, is_vat: true },
    ], { defaultToNull: false }), 'components')
    await ok(acct.from('tax_code_versions').insert({ tax_code_id: ctx.tax.noVat, effective_from: '2019-01-01' }), 'no-VAT version')

    const { data: existing } = await acct.from('wht_rates').select('applies_to, category').in('applies_to', ['director_fee', 'dividend'])
    await ok(acct.from('wht_rates').insert([
      { applies_to: 'client', category: 'ACC services', rate: 0.075, effective_from: '2019-01-01' },
      { applies_to: 'supplier', category: 'ACC services', rate: 0.075, effective_from: '2019-01-01' },
      ...(existing?.some(r => r.applies_to === 'director_fee') ? [] : [{ applies_to: 'director_fee', category: 'default', rate: 0.2, effective_from: '2019-01-01' }]),
      ...(existing?.some(r => r.applies_to === 'dividend') ? [] : [{ applies_to: 'dividend', category: 'default', rate: 0.08, effective_from: '2019-01-01' }]),
    ], { defaultToNull: false }), 'WHT rates')
  })

  test('Owner adds clients, a supplier and jobs with a team and an hour budget', async () => {
    const owner = await as('owner')
    const clients = await ok(owner.from('clients').insert([
      { name: 'ACC Acme Estates', type: 'corporate', deducts_wht: true, wht_category: 'ACC services' },
      { name: 'ACC Private Client', type: 'private_individual' },
    ], { defaultToNull: false }).select('id, name'), 'clients')
    ctx.clients = { acme: clients!.find(c => c.name === 'ACC Acme Estates')!.id, private: clients!.find(c => c.name === 'ACC Private Client')!.id }
    ctx.supplier = (await one(owner.from('suppliers').insert({ name: 'ACC Kojo CAD Services', type: 'freelance_cad', wht_category: 'ACC services' }).select('id'))).id

    const office = await one(owner.from('jobs').insert({
      title: 'ACC Office block', client_id: ctx.clients.acme, contract_mode: 'consultancy', fee: 100000, retention_pct: 10,
      project_lead_staff_id: staffId('ACC Lead'), start_date: '2019-01-15', due_date: '2026-12-31',
    }).select('id, job_number'), 'office job')
    const house = await one(owner.from('jobs').insert({ title: 'ACC House extension', client_id: ctx.clients.private, fee: 5000 }).select('id'), 'house job')
    ctx.jobs = { office: office.id, house: house.id }
    expect(office.job_number, 'job numbered MEL-YYYY-NNN').toMatch(/^MEL-\d{4}-\d{3}$/)

    await ok(owner.from('job_team').insert([
      { job_id: office.id, staff_id: staffId('ACC Engineer') }, { job_id: office.id, staff_id: staffId('ACC Engineer Two') },
    ], { defaultToNull: false }), 'team')
    const role = await one(owner.from('budget_roles').select('id').eq('name', 'Graduate Engineer'))
    await ok(owner.from('job_hour_budgets').insert({ job_id: office.id, budget_role_id: role.id, hours: 10 }), 'hour budget')
    expect(fx().today).toBeTruthy()
  })
})
