// Foreign-key pickers. Each source is something the role entering the data can
// read: Admin picks accounts from account_picker (names only, A-003).
import type { Lookup } from './types'

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export const lookups = {
  client: { source: 'clients', select: 'id, name', label: (r) => s(r.name) },
  referrer: { source: 'referrers', select: 'id, name, organisation', label: (r) => s(r.name) },
  supplier: { source: 'suppliers', select: 'id, name', label: (r) => s(r.name) },
  job: {
    source: 'jobs', select: 'id, job_number, title',
    label: (r) => `${s(r.job_number)} ${s(r.title)}`.trim(),
    aliases: (r) => [s(r.job_number), s(r.title)],
  },
  account: { source: 'account_picker', select: 'id, name', label: (r) => s(r.name) },
  staff: { source: 'staff', select: 'id, full_name', label: (r) => s(r.full_name) },
  budgetRole: { source: 'budget_roles', select: 'id, name', label: (r) => s(r.name) },
  category: {
    source: 'expense_categories', select: 'id, name, parent:parent_id(name)',
    label: (r) => {
      const parent = (r.parent as { name?: string } | null)?.name
      return parent ? `${parent} > ${s(r.name)}` : s(r.name)
    },
    aliases: (r) => [s(r.name)],
  },
  jobType: { source: 'job_types', select: 'id, name', label: (r) => s(r.name) },
  leaveType: { source: 'leave_types', select: 'id, name', label: (r) => s(r.name) },
  taxCode: { source: 'tax_codes', select: 'id, name', label: (r) => s(r.name) },
  director: { source: 'directors', select: 'id, full_name', label: (r) => s(r.full_name) },
} satisfies Record<string, Lookup>
