// Brief §13 items 29-36: timesheets, the entry window, leave, utilisation.
// Dates are relative to today, in working days, as the window is.
import { randomUUID } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { as, fx, ok, one, rejected, staffId } from '../lib/session'
import { addDays, ctx, leaveType } from '../lib/ctx'

const ENG = () => staffId('ACC Engineer')
const entry = (o: Record<string, unknown>) => ({ category: 'job', job_id: ctx.jobs.office, description: 'ACC work', activity_custom: 'Acceptance test', ...o })
let monday = ''

describe('Timesheets and leave', () => {
  test('29 · A phone save retried after a lost response isn\'t duplicated; approval updates hours vs budget', async () => {
    const eng = await as('engineer', 'aal1')
    const ref = randomUUID()
    const row = entry({ client_ref: ref, staff_id: ENG(), work_date: fx().d3, hours: 8, description: 'ACC Beam design' })
    await ok(eng.from('timesheet_entries').upsert(row, { onConflict: 'client_ref', ignoreDuplicates: true }), 'save')
    await ok(eng.from('timesheet_entries').upsert(row, { onConflict: 'client_ref', ignoreDuplicates: true }), 'retry')
    const mine = (await ok(eng.from('timesheet_entries').select('id, status, billable').eq('client_ref', ref)))!
    expect(mine.length, 'not duplicated').toBe(1)
    expect(mine[0].status).toBe('submitted')
    expect(mine[0].billable, 'D-014 job time billable by default').toBe(true)
    expect(await rejected(eng.from('timesheet_entries').update({ status: 'approved' }).eq('id', mine[0].id)), 'approve own').toMatch(/approver/)

    const lead = await as('lead')
    await ok(lead.from('timesheet_entries').update({ status: 'approved' }).eq('id', mine[0].id), 'lead approves')
    const h = await one(lead.from('job_hours_vs_budget').select('approved_hours').eq('job_id', ctx.jobs.office).eq('budget_role', 'Graduate Engineer'))
    expect(Number(h.approved_hours), 'hours vs budget').toBe(8)
  })

  test('30 · Self-entry closes after day 3; days 4-10 only the Project lead (with a reason, marked late); day 11+ only the Owner', async () => {
    const eng = await as('engineer', 'aal1')
    expect(await rejected(eng.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: fx().d4, hours: 3 }))), 'own day 4').toMatch(/entry window.*closed.*Project lead/)
    expect(await rejected(eng.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: addDays(fx().today, 1), hours: 1, category: 'internal', job_id: null }))), 'future').toMatch(/future/)
    expect(await rejected(eng.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: fx().today, hours: 0.3 }))), 'A-013 quarter hours').toMatch(/check constraint/)

    const lead = await as('lead')
    expect(await rejected(lead.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: fx().d4, hours: 3 }))), 'late without a reason').toMatch(/reason/)
    expect(await rejected(lead.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: fx().d11, hours: 2, late_reason: 'x' }))), 'lead on day 11').toMatch(/can't enter or change time/)
    expect(await rejected(lead.from('timesheet_entries').update({ hours: 1 }).eq('staff_id', ENG()).eq('status', 'approved')), 'approved entries locked').toMatch(/approved and locked/)
    const late = await one(lead.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: fx().d4, hours: 3, description: 'ACC site visit', late_reason: 'On site without signal' }))
      .select('is_late_entry, entered_by'), 'lead enters day 4')
    expect(late.is_late_entry, 'marked Late entry').toBe(true)
    expect(late.entered_by, 'with who entered it').toBe((await lead.auth.getUser()).data.user!.id)

    const owner = await as('owner')
    await ok(owner.from('timesheet_entries').insert(entry({ staff_id: ENG(), work_date: fx().d11, hours: 2, category: 'internal', job_id: null, late_reason: 'ACC forgot admin time' })), 'owner on day 11')
  })

  test('31 · The Project lead\'s own missing day is the Owner\'s from day 4; compliance shows on-time %', async () => {
    const lead = await as('lead')
    expect(await rejected(lead.from('timesheet_entries').insert(entry({ staff_id: staffId('ACC Lead'), work_date: fx().d4, hours: 2, category: 'internal', job_id: null }))),
      'lead\'s own day 4').toMatch(/closed.*the Owner/)
    const owner = await as('owner')
    await ok(owner.from('timesheet_entries').insert(entry({ staff_id: staffId('ACC Lead'), work_date: fx().d4, hours: 4, category: 'internal', job_id: null, late_reason: 'ACC lead travelling' })), 'owner enters it')
    const c = (await ok<any[]>(lead.rpc('timesheet_compliance', { p_from: fx().d11, p_to: fx().today })))!.find(r => r.full_name === 'ACC Engineer')
    expect([c.on_time_days, c.late_days], 'on time 1, late 2').toEqual([1, 2])
    expect(Number(c.on_time_pct)).toBeLessThan(100)
  })

  test('36 · The Owner\'s own time is auto-approved and counts in utilisation (% of target)', async () => {
    const owner = await as('owner')
    const e = await one(owner.from('timesheet_entries').insert(entry({ staff_id: staffId('ACC Owner'), work_date: fx().today, hours: 6, description: 'ACC client meeting' })).select('status'))
    expect(e.status).toBe('approved')
    const u = (await ok<any[]>(owner.rpc('utilisation', { p_from: fx().today, p_to: fx().today })))!.find(r => r.full_name === 'ACC Owner')
    expect(Number(u.utilisation_pct)).toBeGreaterThan(0)
  })

  test('35 · A job over a role\'s hour budget is flagged on the Delivery panel', async () => {
    const owner = await as('owner')
    const f = await one(owner.from('jobs_flagged').select('over_hours_budget').eq('job_id', ctx.jobs.office))
    expect(f.over_hours_budget, 'Graduate Engineer: 8 + 3 = 11 h of 10').toBe(true)
  })

  test('30 · A public holiday in between extends each deadline by a day', async () => {
    const acct = await as('accountant')
    let d = addDays(fx().today, -1)
    while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1)
    expect(d > fx().d4, 'a working day between day 4 and today').toBe(true)
    await ok(acct.from('public_holidays').insert({ holiday_date: d, name: 'ACC test holiday' }), 'holiday')
    const eng2 = await as('engineer2', 'aal1')
    await ok(eng2.from('timesheet_entries').insert(entry({ staff_id: staffId('ACC Engineer Two'), work_date: fx().d4, hours: 7, description: 'ACC detailing' })),
      'old day 4 is day 3 again')
  })

  test('34 · Frozen rates don\'t move when a cost or the overhead share changes; Project leads see charge-out rates only', async () => {
    const owner = await as('owner')
    const snap = async () => one(owner.from('timesheet_rate_snapshots').select('cost_rate, charge_out_rate, entry:timesheet_entries!inner(description)').eq('entry.description', 'ACC Beam design'))
    const s = await snap()
    expect([Number(s.cost_rate), Number(s.charge_out_rate)], 'cost 4,065 × 1.25 / 100; charge-out × 1.20').toEqual([50.81, 60.97])
    await ok(owner.from('staff_cost_history').insert({ staff_id: ENG(), effective_from: fx().today, monthly_cost: 5000, notes: 'ACC pay rise' }), 'pay rise')
    if (ctx.todaySettingsId) await ok(owner.from('settings_versions').update({ overhead_share: 0.4 }).eq('id', ctx.todaySettingsId), 'overhead change')
    expect((await ok(owner.from('staff_cost_history').update({ monthly_cost: 1 }).eq('staff_id', ENG()).select('id')))!.length, 'cost history never overwritten').toBe(0)
    const after = await snap()
    expect(Number(after.cost_rate), 'snapshot unchanged').toBe(50.81)
    const lead = await as('lead')
    expect((await ok(lead.from('timesheet_rate_snapshots').select('entry_id')))!.length, 'lead sees no cost rates').toBe(0)
    expect((await ok(lead.from('timesheet_charge_out').select('*').limit(5)))!.length, 'lead sees charge-out rates').toBeGreaterThan(0)
  })

  test('32 · Approving 5 days of annual leave fills them with Leave entries, stops reminders, cuts the balance and the utilisation target', async () => {
    const t = new Date(`${fx().today}T00:00:00Z`)
    monday = addDays(fx().today, 14 - ((t.getUTCDay() + 6) % 7))
    const owner = await as('owner')
    const annual = await leaveType('Annual')
    await ok(owner.from('leave_entitlements').insert({ staff_id: ENG(), leave_type_id: annual, leave_year: Number(monday.slice(0, 4)), entitled_days: 15 }), 'entitlement')
    await ok(owner.from('public_holidays').insert({ holiday_date: addDays(monday, 9), name: 'ACC holiday inside leave' }), 'holiday')

    const eng = await as('engineer', 'aal1')
    const reqs = (await ok(eng.from('leave_requests').insert([
      { staff_id: ENG(), leave_type_id: annual, start_date: monday, end_date: addDays(monday, 4), reason: 'ACC family visit' },
      { staff_id: ENG(), leave_type_id: annual, start_date: addDays(monday, 7), end_date: addDays(monday, 11) },
    ], { defaultToNull: false }).select('id, working_days, start_date')))!
    expect(reqs.find(r => r.start_date === monday)!.working_days, 'five working days').toBe(5)
    expect(reqs.find(r => r.start_date !== monday)!.working_days, 'a public holiday inside isn\'t a leave day').toBe(4)
    expect(await rejected(eng.from('leave_requests').update({ status: 'approved' }).eq('id', reqs[0].id)), 'approve own').toMatch(/not this person's leave approver/)

    const lead = await as('lead')
    expect((await ok(lead.from('notifications').select('id').eq('kind', 'leave_requested').in('record_id', reqs.map(r => r.id))))!.length, 'approver notified').toBeGreaterThan(0)
    await ok(lead.from('leave_requests').update({ status: 'approved' }).in('id', reqs.map(r => r.id)), 'lead approves')
    expect((await ok(owner.from('timesheet_entries').select('id').eq('staff_id', ENG()).eq('category', 'leave')))!.length, 'Leave entries').toBe(9)
    const missing = (await ok<any[]>(owner.rpc('missing_timesheet_days', { p_from: monday, p_to: addDays(monday, 11) })))!.filter(m => m.staff_id === ENG())
    expect(missing.length, 'no reminders for leave days').toBe(0)
    const bal = await one(owner.from('leave_balances').select('available').eq('staff_id', ENG()).eq('leave_type_id', annual))
    expect(Number(bal.available), 'balance 15 − 5 − 4').toBe(6)
    const u = (await ok<any[]>(owner.rpc('utilisation', { p_from: monday, p_to: monday })))!
    const target = (n: string) => Number(u.find(r => r.full_name === n).target_hours)
    expect(target('ACC Engineer'), 'utilisation target reduced pro rata').toBeLessThan(target('ACC Engineer Two'))
  })

  test('33 · Going below zero needs the Owner; colleagues see only names and dates', async () => {
    const annual = await leaveType('Annual')
    const eng = await as('engineer', 'aal1')
    const trip = await one(eng.from('leave_requests').insert({ staff_id: ENG(), leave_type_id: annual, start_date: addDays(monday, 14), end_date: addDays(monday, 28), reason: 'ACC long trip' }).select('id'))
    const lead = await as('lead')
    expect(await rejected(lead.from('leave_requests').update({ status: 'approved' }).eq('id', trip.id)), 'lead approves an overdraft').toMatch(/below zero.*Owner.*Unpaid/)
    const owner = await as('owner')
    await ok(owner.from('leave_requests').update({ status: 'approved' }).eq('id', trip.id), 'owner approves')
    const eng2 = await as('engineer2', 'aal1')
    expect((await ok(eng2.from('leave_requests').select('id').eq('staff_id', ENG())))!.length, 'no type or reason for colleagues').toBe(0)
    const cal = (await ok(eng2.from('leave_calendar').select('*').eq('full_name', 'ACC Engineer')))!
    expect(cal.length, 'names and dates on the calendar').toBe(3)
    expect(Object.keys(cal[0]).sort()).toEqual(['end_date', 'full_name', 'id', 'start_date'])
    await ok(eng.from('leave_requests').update({ status: 'cancelled' }).eq('id', trip.id), 'cancel before it starts')
    expect((await ok(owner.from('timesheet_entries').select('id').eq('staff_id', ENG()).eq('category', 'leave')))!.length, 'its Leave entries go').toBe(9)
  })
})
