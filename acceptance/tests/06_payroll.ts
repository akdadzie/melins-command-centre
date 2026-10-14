// Brief §13 items 20, 21 (and D-022 to D-024): payroll import, checks,
// approval and payslips. Uses August 2019, when only the suite's people existed.
import { describe, expect, test } from 'vitest'
import { as, ok, one, rejected, staffId } from '../lib/session'
import { ctx } from '../lib/ctx'

const AUG = '2019-08-01'
const r2 = (n: number) => Math.round(n * 100) / 100
const st: Record<string, string> = {}

function line(run: string, name: string, basic: number, paye: number, nsp: boolean) {
  const ssnit = nsp ? 0 : r2(basic * 0.055)
  const net = r2(basic - ssnit - paye)
  const employer = nsp ? 0 : r2(basic * 0.13)
  return { run_id: run, staff_id: staffId(name), sheet_kind: nsp ? 'nsp' : 'staff', basic, gross: basic, ssnit_employee: ssnit,
           taxable_income: r2(basic - ssnit), paye, net_pay: net, loan_deduction: 0, bank_amount: net, ssnit_employer: employer,
           sheet_cost_to_company: r2(basic + employer) }
}
const checks = async (run: string) => (await ok<any[]>((await as('accountant')).rpc('payroll_checks', { p_run: run })))!

describe('Payroll (Aug 2019)', () => {
  test('20 · A run with a missing person or a line where gross − deductions ≠ net can\'t be approved', async () => {
    const acct = await as('accountant')
    const owner = await as('owner')
    const loan = await one(acct.from('staff_loans').insert({ staff_id: staffId('ACC Engineer'), amount: 3000, purpose: 'ACC school fees', monthly_instalment: 500,
      first_deduction_month: AUG }).select('id'), 'loan')
    st.loan = loan.id
    await ok(owner.from('staff_loans').update({ status: 'approved' }).eq('id', loan.id), 'approve loan')
    await ok(owner.from('staff_loans').update({ status: 'paid', payment_date: '2019-07-15', method: 'bank_transfer', account_id: ctx.accounts.bank }).eq('id', loan.id), 'pay loan')

    const run = await one(acct.from('payroll_runs').insert({ period_month: AUG, source_files: ['payroll/2019-08/staff.csv', 'payroll/2019-08/nsp.csv'] }).select('id'))
    st.run = run.id
    await ok(acct.from('payroll_lines').insert([
      line(run.id, 'ACC Owner', 18000, 3500, false), line(run.id, 'ACC Lead', 6600, 900, false), line(run.id, 'ACC Engineer', 3600, 300, false),
      line(run.id, 'ACC Admin', 1200, 0, true), line(run.id, 'ACC NSP', 1200, 0, true),
    ], { defaultToNull: false }), 'import lines (ACC Engineer Two left out)')
    let c = await checks(run.id)
    expect(c.some(x => x.code === 'missing_staff' && x.staff_name === 'ACC Engineer Two'), 'missing person caught').toBe(true)
    expect(c.some(x => x.code === 'loan_instalment_missing' && x.staff_name === 'ACC Engineer'), 'loan instalment must be deducted').toBe(true)
    expect(await rejected(acct.from('payroll_runs').update({ status: 'approved' }).eq('id', run.id)), 'accountant approves').toMatch(/Only the Owner approves payroll/)
    expect(await rejected(owner.from('payroll_runs').update({ status: 'approved' }).eq('id', run.id)), 'missing person').toMatch(/fails its checks/)

    await ok(acct.from('payroll_lines').insert({ run_id: run.id, staff_id: staffId('ACC Engineer Two'), source: 'manual', basic: 3600, gross: 3600, ssnit_employee: 198,
      taxable_income: 3402, paye: 300, net_pay: 3200, bank_amount: 3200, ssnit_employer: 468 }), 'manual line, net wrong')
    c = await checks(run.id)
    expect(c.some(x => x.code === 'net_mismatch'), 'net mismatch caught').toBe(true)
    expect(await rejected(owner.from('payroll_runs').update({ status: 'approved' }).eq('id', run.id)), 'net mismatch').toMatch(/fails its checks/)

    await ok(acct.from('payroll_lines').update({ net_pay: 3102, bank_amount: 3102 }).eq('run_id', run.id).eq('staff_id', staffId('ACC Engineer Two')), 'fix net')
    const eng = await one(acct.from('payroll_lines').select('net_pay').eq('run_id', run.id).eq('staff_id', staffId('ACC Engineer')))
    await ok(acct.from('payroll_lines').update({ loan_deduction: 500, bank_amount: Number(eng.net_pay) - 500 }).eq('run_id', run.id).eq('staff_id', staffId('ACC Engineer')), 'loan deduction')
    const lines = (await ok(acct.from('payroll_lines').select('gross, net_pay, paye, tier1_amount, tier2_amount, ssnit_employee, ssnit_employer, staff_id').eq('run_id', run.id)))!
    const sum = (k: string) => r2(lines.reduce((s, l: any) => s + Number(l[k]), 0))
    const totals = { gross: sum('gross'), net_pay: r2(sum('net_pay') + 0.01), paye: sum('paye') }   // the sheet's 0.01 rounding (D-023)
    await ok(acct.from('payroll_runs').update({ sheet_totals: totals }).eq('id', run.id))
    c = await checks(run.id)
    expect(c.filter(x => x.severity === 'blocking'), 'corrected run passes every check').toEqual([])
    const lead = lines.find(l => l.staff_id === staffId('ACC Lead'))!
    expect(r2(Number(lead.tier1_amount) + Number(lead.tier2_amount)), 'D-024 Tier 1 + Tier 2 = total SSNIT').toBe(r2(r2(6600 * 0.055) + r2(6600 * 0.13)))
    expect(Number(lines.find(l => l.staff_id === staffId('ACC NSP'))!.tier1_amount), 'D-024 no SSNIT for national service').toBe(0)
    await ok(acct.from('payroll_runs').update({ sheet_totals: { ...totals, paye: 1 } }).eq('id', run.id))
    expect((await checks(run.id)).some(x => x.code === 'total_mismatch'), 'totals must match the sheet').toBe(true)
    await ok(acct.from('payroll_runs').update({ sheet_totals: totals }).eq('id', run.id))
  })

  test('20 · Approval creates the PAYE and SSNIT Tier 1 and Tier 2 lines, records loan repayments and issues one payslip each', async () => {
    const owner = await as('owner')
    const acct = await as('accountant')
    await ok(owner.from('payroll_runs').update({ status: 'approved' }).eq('id', st.run), 'approve')
    const lines = (await ok(acct.from('statutory_lines').select('type, amount_due, due_date, auto_key').like('auto_key', `%${st.run}`)))!
    const paye = lines.find(l => l.type === 'paye')!
    expect(Number(paye.amount_due), 'PAYE line').toBe(5000)
    expect(paye.due_date, 'due 15 September').toBe('2019-09-15')
    const pl = (await ok(acct.from('payroll_lines').select('ssnit_employee, ssnit_employer').eq('run_id', st.run)))!
    const ssnit = r2(pl.reduce((s, l) => s + Number(l.ssnit_employee) + Number(l.ssnit_employer), 0))
    const tiers = r2(lines.filter(l => ['ssnit_tier1', 'ssnit_tier2'].includes(l.type)).reduce((s, l) => s + Number(l.amount_due), 0))
    expect(tiers, 'Tier 1 and Tier 2 lines').toBe(ssnit)
    const rep = (await ok(acct.from('staff_loan_repayments').select('amount, method').eq('loan_id', st.loan)))!
    expect(rep.filter(r => r.method === 'salary_deduction').reduce((s, r) => s + Number(r.amount), 0), 'loan repayment from the deduction').toBe(500)
    expect((await ok(owner.from('ledger_entries').select('id').eq('source_id', st.run)))!.length, 'A-012 net pay posts only when paid').toBe(0)
    expect(await rejected(acct.from('payroll_lines').update({ paye: 0 }).eq('run_id', st.run)), 'approved lines').toMatch(/locked/)

    await ok(acct.from('payroll_runs').update({ paid_date: '2019-08-28', account_id: ctx.accounts.bank }).eq('id', st.run), 'paid date')
    await ok(acct.from('payroll_runs').update({ status: 'issued' }).eq('id', st.run), 'issue')
    const bank = r2((await ok(acct.from('payroll_lines').select('bank_amount').eq('run_id', st.run)))!.reduce((s, l) => s + Number(l.bank_amount), 0))
    expect(-Number((await one(owner.from('ledger_entries').select('amount').eq('source_id', st.run))).amount), 'bank amounts leave the account').toBe(bank)
    const slips = (await ok(acct.from('payslips').select('id, is_allowance_statement').eq('run_id', st.run)))!
    expect(slips.length, 'one payslip per person').toBe(6)
    expect(slips.filter(s => s.is_allowance_statement).length, 'national service allowance statements').toBe(2)
  })

  test('21 · Staff see only their own payslips; issued payslips can\'t be edited', async () => {
    const eng = await as('engineer')
    expect((await ok(eng.from('payslips').select('id')))!.length, 'own payslip only').toBe(1)
    expect((await ok(eng.from('payslips').select('id').eq('staff_id', staffId('ACC Engineer Two'))))!.length, 'another person\'s payslip').toBe(0)
    const lines = (await ok(eng.from('payroll_lines').select('loan_deduction')))!
    expect(lines.length, 'own payroll line only').toBe(1)
    expect(Number(lines[0].loan_deduction), 'own deductions visible').toBe(500)
    expect((await ok(eng.from('notifications').select('id').eq('kind', 'payslip_ready')))!.length, 'told the payslip is ready').toBeGreaterThan(0)
    expect((await ok(eng.from('payslips').update({ ytd: {} }).neq('id', '00000000-0000-0000-0000-000000000000').select('id')))!.length, 'edit').toBe(0)
    const acct = await as('accountant')
    expect(await rejected(acct.from('payslips').update({ ytd: {} }).eq('run_id', st.run)), 'issued payslips are locked').not.toBe('')
  })

  test('21 · Hidden salaries: Directors see no payslips but still see run totals (D-017)', async () => {
    const owner = await as('owner')
    await ok(owner.from('director_hidden_areas').update({ hidden: true }).eq('area', 'salaries'))
    try {
      const dir = await as('director1')
      expect((await ok(dir.from('payslips').select('id').eq('run_id', st.run)))!.length, 'no payslips').toBe(0)
      expect((await ok(dir.from('payroll_runs').select('id').eq('id', st.run)))!.length, 'run totals visible').toBe(1)
    } finally {
      await ok(owner.from('director_hidden_areas').update({ hidden: false }).eq('area', 'salaries'))
    }
  })
})
