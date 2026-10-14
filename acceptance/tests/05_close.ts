// Brief §13 items 11, 13, 14, 25: statements, reconciliation and month close.
// Uses February 2019: only the suite's own accounts and people existed then,
// so nothing of the Owner's is involved.
import { describe, expect, test } from 'vitest'
import { as, ok, one, rejected, userId } from '../lib/session'
import { cat, ctx } from '../lib/ctx'

const FEB = '2019-02-01'
const ids: Record<string, string> = {}

describe('Statements, reconciliation and month close (Feb 2019)', () => {
  test('11 · An unmatched statement credit creates a "Record this receipt" task and blocks the close until recorded and confirmed', async () => {
    const owner = await as('owner')
    const inv = await one(owner.from('invoices').insert({ job_id: ctx.jobs.house, invoice_date: '2019-02-10', notes: 'ACC feb' }).select('id'))
    ids.inv = inv.id
    await ok(owner.from('invoice_lines').insert({ invoice_id: inv.id, description: 'Site inspection', tax_code_id: ctx.tax.noVat, net_amount: 3000 }))
    await ok(owner.from('invoices').update({ status: 'approved' }).eq('id', inv.id), 'approve')
    const admin = await as('admin')
    ids.courier = (await one(admin.from('expenses').insert({ expense_date: '2019-02-05', category_id: await cat('Postage and courier'), description: 'ACC Courier to client',
      amount: 100, payment_source: 'petty_cash', account_id: ctx.accounts.petty }).select('id'))).id

    const acct = await as('accountant')
    const imp = await one(acct.from('statement_imports').insert({ account_id: ctx.accounts.bank, period_start: FEB, period_end: '2019-02-28', closing_balance: 13000, source_format: 'gcb_csv' }).select('id'))
    const line = await one(acct.from('statement_lines').insert({ import_id: imp.id, line_date: '2019-02-20', description: 'ACC TRF FROM PRIVATE CLIENT', amount: 3000 }).select('id'))
    await ok(acct.from('statement_lines').update({ status: 'record_task' }).eq('id', line.id), 'send to Admin')
    expect((await ok(admin.from('action_items').select('id').eq('kind', 'record_receipt').eq('status', 'open').eq('record_id', line.id)))!.length, 'task').toBe(1)
    const task = await one(admin.from('receipt_tasks').select('amount, statement_line_id').eq('statement_line_id', line.id))
    expect(Number(task.amount), 'admin sees the amount to record').toBe(3000)
    expect((await ok(admin.from('statement_lines').select('id')))!.length, 'admin cannot read statements').toBe(0)

    expect(await rejected(acct.rpc('close_month', { p_month: FEB })), 'close with open items').toMatch(/can't close yet/)
    const blockers = (await ok<any[]>(acct.rpc('month_close_blockers', { p_month: FEB })))!.map(b => b.kind)
    expect(blockers, 'the unrecorded credit blocks').toContain('statement_line')
    expect(blockers, '14: the unreviewed expense blocks').toContain('unreviewed_entry')

    const r = await one(admin.from('receipts').insert({ client_id: ctx.clients.private, receipt_date: '2019-02-20', cash_amount: 3000, account_id: ctx.accounts.bank,
      method: 'bank_transfer', reference: 'ACC-TRF', source: 'found_on_statement', statement_line_id: line.id }).select('id'))
    await ok(admin.from('receipt_allocations').insert({ receipt_id: r.id, invoice_id: inv.id, cash_amount: 3000 }))
    expect((await ok(admin.from('action_items').select('id').eq('kind', 'record_receipt').eq('status', 'open').eq('record_id', line.id)))!.length, 'task closes').toBe(0)
    expect((await ok<any[]>(acct.rpc('month_close_blockers', { p_month: FEB })))!.map(b => b.kind), 'must still be confirmed').toContain('unconfirmed_receipt')
    await ok(acct.from('receipts').update({ status: 'confirmed' }).eq('id', r.id), 'confirm')
  })

  test('14 · An Admin entry stays Recorded until the Accountant reviews or queries it', async () => {
    const acct = await as('accountant')
    const admin = await as('admin')
    await ok(acct.from('expenses').update({ review_status: 'queried', query_note: 'Attach the courier receipt' }).eq('id', ids.courier), 'query')
    expect((await ok(admin.from('action_items').select('id').eq('kind', 'fix_queried_entry').eq('status', 'open').eq('record_id', ids.courier)))!.length, 'back to Admin').toBe(1)
    await ok(admin.from('expenses').update({ receipt_path: 'receipts/acc-courier.jpg' }).eq('id', ids.courier), 'admin fixes')
    expect((await one(acct.from('expenses').select('review_status').eq('id', ids.courier))).review_status, 'back for review').toBe('recorded')
    expect(await rejected(admin.from('expenses').update({ review_status: 'reviewed' }).eq('id', ids.courier)), 'admin reviews').toMatch(/Only the Accountant/)
    expect((await ok(admin.from('action_items').select('id').eq('kind', 'fix_queried_entry').eq('status', 'open').eq('record_id', ids.courier)))!.length, 'query task closes').toBe(0)
    await ok(acct.from('expenses').update({ review_status: 'reviewed' }).eq('id', ids.courier), 'review')
  })

  test('13 · A reconciliation with a GHS 45 difference can\'t close until explained', async () => {
    const acct = await as('accountant')
    for (const [key, id] of Object.entries(ctx.accounts)) {
      const rec = await one(acct.from('reconciliations').insert({ account_id: id, month: FEB, statement_balance: 0 }).select('id, calculated_balance'))
      const stmt = Number(rec.calculated_balance) + (key === 'bank' ? 45 : 0)
      const upd = await one(acct.from('reconciliations').update({ statement_balance: stmt }).eq('id', rec.id).select('id, difference'))
      ids[`rec_${key}`] = rec.id
      if (key === 'bank') {
        expect(Number(upd.difference), 'difference').toBe(45)
        expect(await rejected(acct.from('reconciliations').update({ status: 'closed' }).eq('id', rec.id)), 'close with 45').toMatch(/differ by GHS 45\.00/)
        await ok(acct.from('reconciliations').update({ status: 'closed', explanation: 'ACC bank charges, posting in March' }).eq('id', rec.id), 'explained')
      } else {
        await ok(acct.from('reconciliations').update({ status: 'closed' }).eq('id', rec.id), `close ${key}`)
      }
    }
    await ok(acct.rpc('close_month', { p_month: FEB }), 'close the month')
    expect((await one(acct.from('month_closes').select('status').eq('month', FEB))).status, '11/13/14: closes once everything is done').toBe('closed')
  })

  test('25 · A closed month can\'t be edited; only the Owner reopens it, with a reason, and it\'s logged', async () => {
    const admin = await as('admin')
    expect(await rejected(admin.from('expenses').update({ description: 'ACC changed' }).eq('id', ids.courier)), 'edit').toMatch(/is closed/)
    expect(await rejected(admin.from('expenses').insert({ expense_date: '2019-02-15', category_id: await cat('Postage and courier'), description: 'ACC late', amount: 10,
      payment_source: 'petty_cash', account_id: ctx.accounts.petty })), 'new entry dated in it').toMatch(/is closed/)
    const acct = await as('accountant')
    expect(await rejected(acct.rpc('reopen_month', { p_month: FEB, p_reason: 'fix' })), 'accountant reopens').toMatch(/Only the Owner/)
    const owner = await as('owner')
    expect(await rejected(owner.rpc('reopen_month', { p_month: FEB, p_reason: '' })), 'no reason').toMatch(/reason/)
    await ok(owner.rpc('reopen_month', { p_month: FEB, p_reason: 'ACC correct the courier category' }), 'reopen')
    const log = await one(owner.from('month_reopenings').select('reason, reopened_by').eq('month', FEB))
    expect(log.reason).toBe('ACC correct the courier category')
    expect(log.reopened_by).toBe(userId('owner'))
    const audit = await ok(owner.from('audit_log').select('id').eq('table_name', 'month_closes').contains('new_data', { status: 'open', month: FEB }))
    expect(audit!.length, 'in the audit log').toBeGreaterThan(0)
  })
})
