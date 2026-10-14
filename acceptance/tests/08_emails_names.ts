// D-056 (Security Advisor, 14 Oct 2026): nobody signed out, and no Staff
// member, can read another user's email. Names stay visible wherever a
// screen needs them (Timesheet approvals, Team, Leave, Payroll).
import { describe, expect, test } from 'vitest'
import { anon, as, email, fx, ok, staffId, type Who } from '../lib/session'
import { ctx } from '../lib/ctx'

const TEAM = ['ACC Engineer', 'ACC Engineer Two', 'ACC NSP']
const names = (rows: { full_name: string | null }[] | null) => (rows ?? []).map(r => r.full_name)
const blob = (x: unknown) => JSON.stringify(x ?? null)

describe('Emails restricted, names not', () => {
  test('signed out (anon key): no profile, staff record, staff email or user directory', async () => {
    const c = anon()
    for (const [what, p] of [
      ['profiles', c.from('profiles').select('email')],
      ['staff', c.from('staff').select('full_name')],
      ['staff_private', c.from('staff_private').select('email')],
      ['user_directory()', c.rpc('user_directory')],
      ['account_balances', c.from('account_balances').select('*')],
    ] as const) {
      const { data, error } = await p
      expect(error?.message ?? '', `anon: ${what} is refused`).toMatch(/permission denied/)
      expect(data ?? [], `anon: ${what} returns nothing`).toEqual([])
    }
  })

  test.each<Who>(['engineer', 'nsp', 'lead', 'admin'])('%s sees their own email and nobody else\'s', async (who) => {
    const c = await as(who)
    const profiles = await ok(c.from('profiles').select('user_id, email'), 'profiles')
    expect(profiles!.map(p => p.email), 'profiles: own row only').toEqual([email(who)])
    const priv = await ok(c.from('staff_private').select('staff_id, email').not('email', 'is', null), 'staff_private')
    expect(priv!.map(p => p.email).filter(e => e !== email(who)), 'no colleague email in staff_private').toEqual([])
    expect(await ok(c.rpc('user_directory'), 'user_directory'), 'no user directory').toEqual([])
    const staff = await ok(c.from('staff').select('*').like('full_name', 'ACC %'), 'staff')
    expect(staff!.length, 'staff list still loads').toBeGreaterThan(0)
    expect(blob(staff), 'staff records carry no email').not.toMatch(/@melins-acceptance\.invalid/)
  })

  test('the Project lead sees their team\'s names on Timesheet approvals, Team and Leave', async () => {
    const eng = await as('engineer')
    await ok(eng.from('timesheet_entries').insert({
      staff_id: staffId('ACC Engineer'), work_date: fx().today, category: 'job', job_id: ctx.jobs.office, hours: 1,
      description: 'ACC names check', activity_custom: 'Acceptance test',
    }), 'engineer logs an hour')

    const lead = await as('lead')
    // Timesheet: "enter for" picker and the approvals list (entries with the person's name).
    const picker = await ok(lead.from('staff').select('id, full_name, approver_staff_id').eq('is_active', true).like('full_name', 'ACC %'), 'timesheet picker')
    const mine = picker!.filter(s => s.approver_staff_id === staffId('ACC Lead'))
    expect(names(mine).sort(), 'timesheet: team names').toEqual(TEAM)
    const entries = await ok(lead.from('timesheet_entries').select('id, staff:staff(full_name)').eq('description', 'ACC names check'), 'approvals list')
    expect(entries!.map(e => (e.staff as unknown as { full_name: string } | null)?.full_name), 'approvals: name on the entry').toEqual(['ACC Engineer'])
    expect(blob(entries), 'approvals: no email').not.toMatch(/@/)
    // Team screen.
    const team = await ok(lead.from('staff').select('id, full_name, job_title, approver_staff_id').like('full_name', 'ACC %'), 'team')
    expect(names(team), 'team: names').toEqual(expect.arrayContaining(TEAM))
    // Leave: the "for" picker, and requests with the person's name.
    const leavePicker = await ok(lead.from('staff').select('id, full_name').eq('is_active', true).like('full_name', 'ACC %'), 'leave picker')
    expect(names(leavePicker), 'leave: names').toEqual(expect.arrayContaining(TEAM))
    const { error } = await lead.from('leave_requests').select('id, staff:staff(full_name, approver_staff_id)').limit(5)
    expect(error?.message ?? '', 'leave requests load with names').toBe('')
  })

  test('Directors and the Accountant see staff names where they need them', async () => {
    for (const who of ['director1', 'accountant'] as const) {
      const c = await as(who)
      const all = await ok(c.from('staff').select('id, full_name, is_active').like('full_name', 'ACC %').order('full_name'), `${who}: staff`)
      expect(names(all), `${who}: payroll and team names`).toEqual(expect.arrayContaining(['ACC Owner', 'ACC Lead', ...TEAM]))
      expect(await ok(c.rpc('user_directory'), `${who}: user directory`), `${who}: no user directory`).toEqual([])
    }
  })

  test('the Owner still sees everyone\'s email on Settings > Users and for invites', async () => {
    const owner = await as('owner')
    const users = await ok(owner.rpc('user_directory').like('email', '%@melins-acceptance.invalid'), 'user_directory')
    expect(users!.map(u => u.email), 'users screen').toEqual(expect.arrayContaining([email('engineer'), email('lead'), email('accountant')]))
    const invite = await ok(owner.from('staff').select('id, full_name, private:staff_private(email)').eq('id', staffId('ACC Engineer')), 'invite list')
    expect((invite![0].private as unknown as { email: string } | null)?.email, 'staff email for the invite form').toBe(email('engineer'))
  })
})
