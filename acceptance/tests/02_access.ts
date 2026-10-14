// Brief §13 items 3, 4, 5 and 22: who can see and write what, through the API.
import { describe, expect, test } from 'vitest'
import { as, fx, ok, one, rejected, staffId } from '../lib/session'
import { cat, ctx } from '../lib/ctx'

const count = async (p: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => ((await ok(p)) ?? []).length

describe('Access by role', () => {
  test('3 · Owner, Directors and Accountant see and write nothing without 2FA; staff work without it', async () => {
    const owner = await as('owner', 'aal1')
    expect(await count(owner.from('accounts').select('id')), 'owner, no 2FA: accounts').toBe(0)
    expect(await count(owner.from('clients').select('id')), 'owner, no 2FA: clients').toBe(0)
    expect(await rejected(owner.from('clients').insert({ name: 'ACC should fail' })), 'owner, no 2FA: write').toMatch(/row-level security/)
    const acct = await as('accountant', 'aal1')
    expect(await count(acct.from('accounts').select('id')), 'accountant, no 2FA').toBe(0)
    const dir = await as('director1', 'aal1')
    expect(await count(dir.from('jobs').select('id')), 'director, no 2FA').toBe(0)
    const eng = await as('engineer', 'aal1')
    expect(await count(eng.from('my_jobs').select('id').eq('id', ctx.jobs.office)), 'staff without 2FA can work').toBe(1)
  })

  test('4 · Admin gets no balance, total, salary, cost, ledger or director figure, but can post an expense to a named account', async () => {
    const admin = await as('admin')
    for (const t of ['accounts', 'account_balances', 'ledger_entries', 'staff_cost_history', 'settings_versions',
                     'receivables_ageing', 'director_balances', 'statutory_ledger', 'director_transactions', 'payroll_lines']) {
      expect(await count(admin.from(t).select('*').limit(5)), `admin reads ${t}`).toBe(0)
    }
    expect(await ok(admin.rpc('money_panel')), 'money panel').toBeNull()
    expect((await ok<any>(admin.rpc('running_cost')))?.calculated ?? null, 'running cost').toBeNull()
    expect(await count(admin.rpc('vat_workings', { p_month: fx().today })), 'VAT workings').toBe(0)

    const picker = (await ok(admin.from('account_picker').select('id, name').like('name', 'ACC %')))!.map(r => r.name).sort()
    expect(picker, 'picker lists accounts Admin may post to').toEqual(['ACC Bank', 'ACC MoMo', 'ACC Petty cash'])

    const exp = await one(admin.from('expenses').insert({
      expense_date: fx().today, category_id: await cat('Office supplies and stationery'), description: 'ACC Printer paper',
      amount: 250, payment_source: 'company_account', account_id: ctx.accounts.bank,
    }).select('review_status'), 'admin expense')
    expect(exp.review_status, 'admin expense awaits review').toBe('recorded')
    expect(await rejected(admin.from('expenses').insert({
      expense_date: fx().today, category_id: await cat('Rent'), description: 'ACC should fail', amount: 1,
      payment_source: 'company_account', account_id: ctx.accounts.reserve,
    })), 'admin posting to a non-admin account').toMatch(/Admin may not post to this account/)
  })

  test('5 · Staff can read neither staff costs nor anyone else\'s timesheets, invoices or expenses', async () => {
    const lead = await as('lead')
    await ok(lead.from('timesheet_entries').insert({
      staff_id: staffId('ACC Lead'), work_date: fx().today, category: 'job', job_id: ctx.jobs.office, hours: 1,
      description: 'ACC design review', activity_custom: 'Acceptance test',
    }), 'lead logs an hour')
    const eng = await as('engineer')
    expect(await count(eng.from('staff_cost_history').select('id')), 'staff costs').toBe(0)
    expect(await count(eng.from('timesheet_entries').select('id').neq('staff_id', staffId('ACC Engineer'))), 'others\' timesheets').toBe(0)
    expect(await count(eng.from('jobs').select('id')), 'jobs table (fees)').toBe(0)
    expect(await count(eng.from('my_jobs').select('id').eq('id', ctx.jobs.office)), 'own job via my_jobs').toBe(1)
    expect(await count(eng.from('invoices').select('id')), 'invoices').toBe(0)
    expect(await count(eng.from('expenses').select('id')), 'others\' expenses').toBe(0)
    expect(await count(eng.from('payslips').select('id').neq('staff_id', staffId('ACC Engineer'))), 'others\' payslips').toBe(0)
  })

  test('22 · Directors read everything and write nothing', async () => {
    const dir = await as('director1')
    expect(await count(dir.from('accounts').select('id').like('name', 'ACC %')), 'reads accounts').toBe(4)
    expect(await count(dir.from('staff_cost_history').select('id').in('staff_id', Object.values(fx().staff))), 'reads staff costs').toBe(6)
    expect(await ok(dir.rpc('money_panel')), 'money panel').not.toBeNull()
    expect(await count(dir.from('settings_versions').select('id')), 'reads settings').toBeGreaterThan(0)
    expect(await rejected(dir.from('clients').insert({ name: 'ACC director client' })), 'create').not.toBe('')
    expect(await count(dir.from('clients').update({ notes: 'x' }).eq('id', ctx.clients.acme).select('id')), 'edit').toBe(0)
    expect(await count(dir.from('expenses').delete().like('description', 'ACC %').select('id')), 'delete').toBe(0)
    expect(await count(dir.from('expenses').update({ review_status: 'reviewed' }).like('description', 'ACC %').select('id')), 'review').toBe(0)
    expect(await count(dir.from('director_hidden_areas').update({ hidden: true }).neq('area', '').select('area')), 'change settings').toBe(0)
    expect(await rejected(dir.rpc('close_month', { p_month: '2019-02-01' })), 'close a month').not.toBe('')
  })

  test('22 · An area the Owner hides disappears for Directors only', async () => {
    const owner = await as('owner')
    await ok(owner.from('director_hidden_areas').update({ hidden: true }).in('area', ['salaries', 'staff_costs']), 'hide')
    try {
      const dir = await as('director1')
      expect(await count(dir.from('staff_cost_history').select('id')), 'hidden staff costs').toBe(0)
      expect(await count(dir.from('accounts').select('id').like('name', 'ACC %')), 'other areas still visible').toBe(4)
      const acct = await as('accountant')
      expect(await count(acct.from('staff_cost_history').select('id').in('staff_id', Object.values(fx().staff))), 'accountant unaffected').toBe(6)
    } finally {
      await ok(owner.from('director_hidden_areas').update({ hidden: false }).neq('area', ''), 'unhide')
    }
  })
})
