// D-057 (Security Advisor, 14 Oct 2026): every money and payroll view and
// function, queried straight through the API as Staff and as Admin, gives
// them no balance, total, salary or statement (brief §4, A-003, A-019).
// The Owner reads the same sources, so an empty answer means "refused", not
// "no data".
import { describe, expect, test } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { as, fx, ok } from '../lib/session'

type Res = { data: unknown; error: { message: string } | null }
const rows = async (p: PromiseLike<Res>): Promise<unknown[]> => {
  const { data, error } = await p
  if (error) return []                    // refused outright also counts as nothing
  return Array.isArray(data) ? data : data == null ? [] : [data]
}
const blank = (x: unknown) => x == null || (typeof x === 'object' && Object.values(x as object).every(v => v == null))

// Views and tables with balances, totals, salaries, costs or statements.
const MONEY_VIEWS = ['account_balances', 'director_balances', 'receivables_ageing', 'statutory_ledger', 'statutory_plans',
  'tax_credit_balances', 'payroll_cost_changes', 'staff_loan_warnings', 'job_money_status', 'retention_by_job',
  'job_milestone_check', 'timesheet_charge_out']
const MONEY_TABLES = ['accounts', 'ledger_entries', 'staff_cost_history', 'payroll_runs', 'payroll_lines', 'statement_imports',
  'statement_lines', 'reconciliations', 'statutory_lines', 'statutory_payments', 'director_transactions', 'director_payments',
  'tax_credits', 'settings_versions', 'timesheet_rate_snapshots']
// Lists Admin works from (per item, no totals); Staff get none of them.
const ADMIN_LISTS = ['invoices_to_chase', 'supplier_bills_open', 'receipt_tasks', 'staff_loan_picker', 'ready_to_invoice', 'account_picker']

const fns = (c: SupabaseClient) => {
  const month = fx().today.slice(0, 8) + '01'
  return {
    money_panel: c.rpc('money_panel'),
    running_cost: c.rpc('running_cost'),
    monthly_summary: c.rpc('monthly_summary', { p_month: month }),
    accountant_queue: c.rpc('accountant_queue'),
    vat_workings: c.rpc('vat_workings', { p_month: month }),
    entries_to_review: c.rpc('entries_to_review', { p_month: month }),
    payroll_checks: c.rpc('payroll_checks', { p_run: '00000000-0000-0000-0000-000000000000' }),
  } as Record<string, PromiseLike<Res>>
}

describe('Staff and Admin get no money through the API', () => {
  test('control: the Owner reads balances, salaries and the money panel', async () => {
    const owner = await as('owner')
    expect((await rows(owner.from('account_balances').select('id').like('name', 'ACC %'))).length, 'balances').toBe(4)
    expect((await rows(owner.from('staff_cost_history').select('id').in('staff_id', Object.values(fx().staff)))).length, 'salaries').toBe(6)
    expect(await ok(owner.rpc('money_panel')), 'money panel').not.toBeNull()
  })

  test.each(['engineer', 'nsp', 'admin'] as const)('%s: no balance, total, salary or statement from any view or table', async (who) => {
    const c = await as(who)
    for (const v of [...MONEY_VIEWS, ...MONEY_TABLES]) {
      expect(await rows(c.from(v).select('*').limit(5)), `${who} reads ${v}`).toEqual([])
    }
  })

  test.each(['engineer', 'nsp', 'admin'] as const)('%s: money functions return nothing', async (who) => {
    const c = await as(who)
    for (const [name, p] of Object.entries(fns(c))) {
      const r = await rows(p)
      expect(r.every(blank), `${who} calls ${name}: ${JSON.stringify(r).slice(0, 120)}`).toBe(true)
    }
  })

  test.each(['engineer', 'nsp'] as const)('%s: none of Admin\'s working lists, and only their own pay', async (who) => {
    const c = await as(who)
    for (const v of ADMIN_LISTS) expect(await rows(c.from(v).select('*').limit(5)), `${who} reads ${v}`).toEqual([])
    const me = fx().staff[who === 'nsp' ? 'ACC NSP' : 'ACC Engineer']
    expect(await rows(c.from('payslips').select('id').neq('staff_id', me)), 'others\' payslips').toEqual([])
    expect(await rows(c.from('staff_private').select('staff_id').neq('staff_id', me)), 'others\' private details').toEqual([])
    const util = (await rows(c.rpc('utilisation', { p_from: fx().today, p_to: fx().today }))) as { staff_id: string }[]
    expect(util.every(u => u.staff_id === me), 'utilisation: own row only').toBe(true)
  })

  test('admin: the account picker gives names only, and per-invoice amounts carry no totals', async () => {
    const admin = await as('admin')
    const picker = (await rows(admin.from('account_picker').select('*').like('name', 'ACC %'))) as Record<string, unknown>[]
    expect(picker.length, 'accounts Admin may post to').toBe(3)
    expect(Object.keys(picker[0]).sort(), 'picker columns').toEqual(['id', 'name', 'type'])
    expect(await rows(admin.from('staff_private').select('staff_id').neq('staff_id', fx().staff['ACC Admin'])), 'others\' private details').toEqual([])
  })

  test.each(['engineer', 'admin'] as const)('%s: can\'t run finance actions', async (who) => {
    const c = await as(who)
    for (const [name, p] of Object.entries({
      close_month: c.rpc('close_month', { p_month: '2019-03-01' }),
      reopen_month: c.rpc('reopen_month', { p_month: '2019-03-01', p_reason: 'x' }),
      mark_month_reviewed: c.rpc('mark_month_reviewed', { p_month: '2019-03-01' }),
      set_up_leave_year: c.rpc('set_up_leave_year', { p_year: 2031 }),
      promote_custom_activity: c.rpc('promote_custom_activity', { p_custom: 'x', p_group: 'x', p_name: 'x' }),
    })) {
      const { error } = await p
      expect(error?.message ?? '', `${who} runs ${name}`).toMatch(/Only|Not allowed|permission denied/)
    }
  })
})
