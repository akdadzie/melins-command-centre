// Settings are dated versions (brief §7.1): past records keep the values in
// force at the time. Saving with an effective date updates the version that
// starts on that date, or adds a new version copied from the one in force then.
// Pure; unit-tested.
import type { Database } from '../../lib/database.types'
import { parseMoney } from '../../lib/format'

export type SettingsRow = Database['public']['Tables']['settings_versions']['Row']
type Key = keyof SettingsRow

export type Kind = 'text' | 'textarea' | 'email' | 'money' | 'percent' | 'int' | 'decimal' | 'month' | 'select' | 'boolean'
export interface SettingField { name: Key; label: string; kind: Kind; options?: [string, string][]; help?: string; required?: boolean }
export interface SettingGroup { key: string; title: string; who: string; fields: SettingField[] }

export const GROUPS: SettingGroup[] = [
  { key: 'company', title: 'Company and tax details', who: 'Printed on every tax invoice', fields: [
    { name: 'registered_name', label: 'Registered name', kind: 'text', required: true },
    { name: 'tin', label: 'MeLiNS TIN', kind: 'text' },
    { name: 'vat_number', label: 'VAT number', kind: 'text' },
    { name: 'address', label: 'Address', kind: 'textarea' },
    { name: 'accounts_email', label: 'Accounts email', kind: 'email', required: true, help: 'For remittance advices and WHT certificates.' },
    { name: 'invoice_payment_details', label: 'Payment details on invoices', kind: 'textarea',
      help: 'Bank and mobile money details clients pay into. Account numbers are fine here: this is what clients see.' },
    { name: 'financial_year_end_month', label: 'Financial year ends in', kind: 'month' },
    { name: 'tier2_trustee', label: 'SSNIT Tier 2 trustee', kind: 'text' },
  ] },
  { key: 'money', title: 'Targets, pricing and money in', who: 'Pricing (brief §8) and invoicing', fields: [
    { name: 'monthly_fee_target', label: 'Monthly fee target', kind: 'money', required: true },
    { name: 'fee_target_mode', label: 'Target shown', kind: 'select', options: [['fixed', 'The fixed target'], ['calculated', 'The calculated target']] },
    { name: 'desired_cash_buffer', label: 'Desired cash buffer', kind: 'money', help: 'Used in the calculated target.' },
    { name: 'overhead_share', label: 'Overhead share', kind: 'percent' },
    { name: 'target_margin', label: 'Target margin', kind: 'percent' },
    { name: 'default_billable_hours', label: 'Billable hours per month (default)', kind: 'decimal' },
    { name: 'running_cost_override', label: 'Monthly running cost override', kind: 'money', help: 'Blank = use the calculated figure.' },
    { name: 'invoice_terms_days', label: 'Invoice terms (days)', kind: 'int' },
    { name: 'client_wht_base', label: 'Client WHT is worked out on', kind: 'select', options: [['net', 'The VAT-exclusive amount'], ['gross', 'The gross amount']] },
    { name: 'accountant_may_approve_invoices', label: 'The Accountant may approve invoices', kind: 'boolean' },
  ] },
  { key: 'time', title: 'Timesheets and leave', who: 'Entry window (brief §4) and leave year', fields: [
    { name: 'timesheet_self_days', label: 'Own entry for (working days)', kind: 'int' },
    { name: 'timesheet_lead_days', label: 'Project lead may enter up to (working days)', kind: 'int' },
    { name: 'leave_year_start_month', label: 'Leave year starts in', kind: 'month' },
    { name: 'max_carry_over_days', label: 'Annual leave carried over, at most (days)', kind: 'decimal', help: 'Blank = none carried over (A-038).' },
  ] },
  { key: 'bonus', title: '13th-month bonus', who: 'Brief §7.7', fields: [
    { name: 'bonus_base', label: 'Bonus base', kind: 'select', options: [['basic', 'Basic pay'], ['gross', 'Gross pay']] },
    { name: 'bonus_eligibility', label: 'Who qualifies', kind: 'text', help: 'e.g. "All permanent staff in post on 1 December"' },
    { name: 'bonus_payment_month', label: 'Paid in', kind: 'month' },
    { name: 'bonus_prorated', label: 'Pro-rated by months worked', kind: 'boolean' },
  ] },
  { key: 'payroll', title: 'Payroll checks', who: 'Rates and tolerances (D-023, D-024)', fields: [
    { name: 'ssnit_employee_rate', label: 'SSNIT employee', kind: 'percent' },
    { name: 'ssnit_employer_rate', label: 'SSNIT employer', kind: 'percent' },
    { name: 'ssnit_tier1_rate', label: 'Tier 1 share', kind: 'percent' },
    { name: 'ssnit_tier2_rate', label: 'Tier 2 share', kind: 'percent' },
    { name: 'pf_employee_rate', label: 'Provident fund (Tier 3) employee', kind: 'percent' },
    { name: 'pf_employer_rate', label: 'Provident fund (Tier 3) employer', kind: 'percent' },
    { name: 'payroll_line_tolerance', label: 'Line tolerance (GHS)', kind: 'money' },
    { name: 'payroll_total_tolerance', label: 'Totals tolerance (GHS)', kind: 'money' },
  ] },
]

/** What the input shows for a stored value. */
export function toInput(f: SettingField, v: unknown): string | boolean {
  if (f.kind === 'boolean') return Boolean(v)
  if (v === null || v === undefined) return ''
  if (f.kind === 'percent') return String(Math.round(Number(v) * 1_000_000) / 10_000)
  return String(v)
}

/** The stored value for an input, or an error a person can act on. */
export function fromInput(f: SettingField, raw: string | boolean): { ok: true; value: unknown } | { ok: false; error: string } {
  if (f.kind === 'boolean') return { ok: true, value: Boolean(raw) }
  const s = String(raw).trim()
  if (s === '') return f.required ? { ok: false, error: `${f.label} is required.` } : { ok: true, value: null }
  switch (f.kind) {
    case 'money': {
      const n = parseMoney(s)
      return n === null || n < 0 ? { ok: false, error: `${f.label}: enter an amount.` } : { ok: true, value: n }
    }
    case 'percent': {
      const n = Number(s.replace(/%$/, ''))
      return !Number.isFinite(n) || n < 0 || n >= 100 ? { ok: false, error: `${f.label}: enter a percentage, e.g. 25.` } : { ok: true, value: Math.round(n * 10_000) / 1_000_000 }
    }
    case 'int': case 'month': {
      const n = Number(s)
      return !Number.isInteger(n) || n < 0 ? { ok: false, error: `${f.label}: enter a whole number.` } : { ok: true, value: n }
    }
    case 'decimal': {
      const n = Number(s)
      return !Number.isFinite(n) || n < 0 ? { ok: false, error: `${f.label}: enter a number.` } : { ok: true, value: n }
    }
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? { ok: true, value: s } : { ok: false, error: `${f.label}: enter an email address.` }
    default:
      return { ok: true, value: s }
  }
}

/** The version in force on a date (latest effective_from on or before it). */
export function versionAt(versions: SettingsRow[], date: string): SettingsRow | undefined {
  return [...versions].filter((v) => v.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
}

export type SavePlan =
  | { mode: 'update'; id: string; patch: Partial<SettingsRow> }
  | { mode: 'insert'; row: Partial<SettingsRow> }

/** Update the version starting on `date`, or add one copied from the version in force then. */
export function planSave(versions: SettingsRow[], date: string, changes: Partial<SettingsRow>): SavePlan {
  const same = versions.find((v) => v.effective_from === date)
  if (same) return { mode: 'update', id: same.id, patch: changes }
  const base = versionAt(versions, date) ?? [...versions].sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
  const copy: Partial<SettingsRow> = { ...base }
  delete copy.id; delete copy.created_at; delete copy.created_by
  return { mode: 'insert', row: { ...copy, ...changes, effective_from: date } }
}

/** Versions after `date`, which a change from `date` won't reach. */
export function laterVersions(versions: SettingsRow[], date: string): SettingsRow[] {
  return versions.filter((v) => v.effective_from > date)
}
