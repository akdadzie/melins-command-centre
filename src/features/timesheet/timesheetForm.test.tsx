// The timesheet form (D-042): activity required (list or Custom), "what you
// did" at least 10 characters, today's total at the top, Save shows the time,
// last jobs as one-tap buttons, and staff don't get the "Logging for" picker.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { byText, click, renderRoutes, settle, submit, type, type Screen } from '../../test/harness'

const h = vi.hoisted(() => ({ db: null as unknown as import('../../test/harness').FakeDb, role: 'staff' }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeDb, fakeClient } = await import('../../test/harness')
  h.db = createFakeDb()
  const c = fakeClient(h.db)
  return { supabase: c, db: c, appEnv: 'staging', configError: null }
})
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: 'ready', role: h.role, profile: { user_id: 'u-ernest', full_name: 'Ernest Gbadago', role: h.role, staff_id: 's-ernest' } }),
}))

import { TimesheetPage } from './TimesheetPage'
import { todayAccra } from '../../lib/format'

function seed() {
  const today = todayAccra()
  h.db.tables = {
    public_holidays: [],
    timesheet_activities: [
      { id: 'a1', group_name: 'Design', name: 'Design calculations', sort_order: 103, is_active: true },
      { id: 'a2', group_name: 'Drawings', name: 'Drafting/CAD', sort_order: 201, is_active: true },
    ],
    my_jobs: [{ id: 'j1', job_number: 'MEL-2026-001', title: 'Office block' }, { id: 'j2', job_number: 'MEL-2026-002', title: 'Bridge' }],
    jobs: [],
    staff: [],
    timesheet_entries: [
      { id: 'e0', staff_id: 's-ernest', work_date: today, category: 'job', job_id: 'j2', hours: 1.5, description: 'Morning site walk', status: 'submitted',
        entered_by: 'u-ernest', is_late_entry: false, job: { job_number: 'MEL-2026-002', title: 'Bridge' }, activity: { group_name: 'Site', name: 'Supervision' },
        activity_custom: null, created_at: '2026-10-03T08:00:00Z' },
    ],
  }
  h.db.writes = []
  localStorage.clear()
}

let screen: Screen | null = null
afterEach(() => { screen?.unmount(); screen = null })

describe('timesheet form', () => {
  it('needs an activity and 10 characters of description, and saves them', async () => {
    seed()
    screen = await renderRoutes({ '/timesheet': <TimesheetPage /> }, '/timesheet')
    const c = screen.container
    expect(c.querySelector('.today-logged')?.textContent).toBe('Today: 1 h 30 min logged')
    expect(c.textContent).not.toContain('Logging for')
    expect([...c.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Design', 'Drawings', 'Other'])
    expect(byText(c, 'button', 'MEL-2026-002 Bridge')).toBeTruthy()   // the last job, one tap

    await click(byText(c, 'button', 'MEL-2026-002 Bridge'))
    await click(c.querySelector('button[aria-label="15 minutes more"]')!)
    const form = c.querySelector('#timesheet-entry')!
    await type(form.querySelector('textarea')!, 'Beams')
    await submit(form)
    expect(c.querySelector('.form-error')?.textContent).toBe('Choose the activity')

    await type(form.querySelector('select[required]')!, '__custom__')
    await type(form.querySelector('input[maxlength="60"]')!, 'Site photos')
    await submit(form)
    expect(c.querySelector('.form-error')?.textContent).toBe('Say what you did, in at least 10 characters')
    expect(h.db.writes).toEqual([])

    await type(form.querySelector('textarea')!, 'Photos of the existing columns')
    expect(byText(c, '.save-bar button', /^Save /).textContent).toBe('Save 1 h 15 min')
    await submit(form)
    await settle()
    const saved = h.db.writes.find((w) => w.table === 'timesheet_entries')?.payload as Record<string, unknown>
    expect(saved).toMatchObject({ job_id: 'j2', activity_id: null, activity_custom: 'Site photos', description: 'Photos of the existing columns', late_reason: null })
    expect(screen.crashes).toEqual([])
  })
})
