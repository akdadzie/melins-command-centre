import { describe, expect, it } from 'vitest'
import { pivot } from './ActivityReport'

const row = (full_name: string, activity: string, hours: number, job_number: string | null = 'MEL-2026-001') => ({
  staff_id: full_name, full_name, job_id: job_number, job_number, job_title: 'Office block', category: job_number ? 'job' : 'internal',
  activity_group: 'Design', activity, is_custom: false, hours, entries: 1,
})

describe('hours by activity (D-044)', () => {
  const rows = [row('Ernest', 'Design calculations', 6), row('Ibrahim', 'Design calculations', 2), row('Ernest', 'Design checking/review', 1, null)]
  it('groups by activity with the people behind it, biggest first', () => {
    const t = pivot(rows, 'activity')
    expect(t.map((g) => [g.key, g.hours])).toEqual([['Design › Design calculations', 8], ['Design › Design checking/review', 1]])
    expect(t[0].parts).toEqual([['Ernest', 6], ['Ibrahim', 2]])
  })
  it('groups by job (non-job time by its category) and by person', () => {
    expect(pivot(rows, 'job').map((g) => g.key)).toEqual(['MEL-2026-001 Office block', 'Internal / admin'])
    expect(pivot(rows, 'person').map((g) => [g.key, g.hours])).toEqual([['Ernest', 7], ['Ibrahim', 2]])
  })
})
