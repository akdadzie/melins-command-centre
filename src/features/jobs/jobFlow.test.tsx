// Reported 3 Oct: after creating a job and entering its fee, the screen went
// blank. This walks the same steps through the real screens.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { byText, click, createFakeDb, renderRoutes, submit, type, type Screen } from '../../test/harness'

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb> }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeDb: make, fakeClient: client } = await import('../../test/harness')
  h.db = make()
  const c = client(h.db)
  return { supabase: c, db: c, appEnv: 'staging', configError: null }
})
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ state: 'ready', role: 'owner', profile: { user_id: 'u1', full_name: 'Kwasi Dadzie Ennison', role: 'owner', staff_id: 's1' } }),
}))

import { JobDetail } from './JobDetail'
import { ResourceList } from '../../resources/ResourceList'
import * as R from '../../resources/definitions'

function seed() {
  const db = h.db
  db.tables = {
    clients: [{ id: 'c1', name: 'Acme Ltd' }],
    referrers: [], job_types: [{ id: 'jt1', name: 'Structural design of buildings' }],
    staff: [{ id: 's1', full_name: 'Kwasi Dadzie Ennison', is_active: true }],
    jobs: [], job_team: [], job_money_status: [], retention_by_job: [], budget_roles: [],
  }
  db.writes = []
  let n = 0
  // Like the jobs trigger: the next MEL number, and the column defaults.
  db.beforeInsert.jobs = (row) => ({
    contract_mode: 'consultancy', delivery_status: 'not_started', fee_basis: 'lump_sum', retention_pct: 0, retention_basis: 'net',
    percent_complete: 0, is_goodwill: false, is_imported: false, fee: null, fee_percent: null, construction_value: null,
    ...row, job_number: `MEL-2026-${String(++n).padStart(3, '0')}`,
  })
}

let screen: Screen | null = null
afterEach(() => { screen?.unmount(); screen = null })

describe('creating a job and entering its fee', () => {
  it('saves the job and keeps the screen', async () => {
    seed()
    screen = await renderRoutes({ '/jobs': <ResourceList resource={R.jobs} />, '/jobs/:number': <JobDetail /> }, '/jobs')
    const { container } = screen
    await click(byText(container, 'button', '+ New job'))
    const form = container.querySelector('form.resource-form')!
    await type(form.querySelector('#f-jobs-title')!, 'Office block, East Legon')
    await type(form.querySelector('#f-jobs-client_id')!, 'c1')
    await type(form.querySelector('#f-jobs-fee')!, '50,000')
    await submit(form)

    expect(screen.crashes).toEqual([])
    expect(h.db.tables.jobs).toHaveLength(1)
    expect(h.db.tables.jobs[0]).toMatchObject({ title: 'Office block, East Legon', fee: 50000 })
    expect(container.textContent).toContain('MEL-2026-001')
  })

  it('opens the new job and changes its fee', async () => {
    seed()
    h.db.tables.jobs.push(h.db.beforeInsert.jobs({ id: 'j1', title: 'Office block', client_id: 'c1', fee: 50000 }))
    screen = await renderRoutes({ '/jobs': <ResourceList resource={R.jobs} />, '/jobs/:number': <JobDetail /> }, '/jobs')
    const { container } = screen
    await click(byText(container, 'tr', /MEL-2026-001/))
    expect(container.querySelector('h1')?.textContent).toContain('MEL-2026-001')

    await click(byText(container, 'button', 'Edit job'))
    const form = container.querySelector('form.resource-form')!
    await type(form.querySelector('#f-jobs-fee')!, '75000')
    await submit(form)

    expect(screen.crashes).toEqual([])
    expect(h.db.tables.jobs[0].fee).toBe(75000)
    expect(container.querySelector('h1')?.textContent).toContain('MEL-2026-001')
  })
})
