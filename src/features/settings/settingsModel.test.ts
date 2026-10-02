import { describe, expect, it } from 'vitest'
import { fromInput, GROUPS, planSave, toInput, versionAt, type SettingsRow } from './settingsModel'

const field = (name: string) => GROUPS.flatMap((g) => g.fields).find((f) => f.name === name)!
const v = (effective_from: string, extra: Partial<SettingsRow> = {}) =>
  ({ id: `id-${effective_from}`, effective_from, created_at: 'x', created_by: null, tin: null, overhead_share: 0.25, ...extra }) as SettingsRow

describe('settings inputs', () => {
  it('shows and stores percentages as fractions', () => {
    expect(toInput(field('overhead_share'), 0.25)).toBe('25')
    expect(fromInput(field('overhead_share'), '17.5')).toEqual({ ok: true, value: 0.175 })
    expect(fromInput(field('ssnit_employee_rate'), '5.5%')).toEqual({ ok: true, value: 0.055 })
    expect(fromInput(field('overhead_share'), '120').ok).toBe(false)
  })
  it('accepts money with separators, blanks for optional fields, and refuses blanks for required ones', () => {
    expect(fromInput(field('monthly_fee_target'), 'GHS 62,500')).toEqual({ ok: true, value: 62500 })
    expect(fromInput(field('running_cost_override'), '')).toEqual({ ok: true, value: null })
    expect(fromInput(field('registered_name'), ' ').ok).toBe(false)
  })
})

describe('dated versions', () => {
  const versions = [v('2026-01-01'), v('2026-10-01', { tin: 'C000' })]
  it('finds the version in force on a date', () => {
    expect(versionAt(versions, '2026-09-30')!.effective_from).toBe('2026-01-01')
    expect(versionAt(versions, '2026-11-15')!.effective_from).toBe('2026-10-01')
  })
  it('updates a version that starts on the date', () => {
    expect(planSave(versions, '2026-10-01', { vat_number: 'V1' })).toEqual({ mode: 'update', id: 'id-2026-10-01', patch: { vat_number: 'V1' } })
  })
  it('otherwise adds a version copied from the one in force, so earlier records keep their values', () => {
    const plan = planSave(versions, '2027-01-01', { overhead_share: 0.3 })
    expect(plan.mode).toBe('insert')
    if (plan.mode === 'insert') {
      expect(plan.row).toMatchObject({ effective_from: '2027-01-01', tin: 'C000', overhead_share: 0.3 })
      expect(plan.row).not.toHaveProperty('id')
      expect(plan.row).not.toHaveProperty('created_at')
    }
  })
})
