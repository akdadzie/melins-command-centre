// One definition per table: drives the form, the list, and CSV template /
// import / export. Enum values match the database CHECK constraints.
// Access here only shapes the screens; RLS in the database is the real guard.
import type { Role } from '../auth/roles'
import { todayAccra } from '../lib/format'
import { lookups } from './lookups'
import type { Option, ResourceDef } from './types'

const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))

const O: Role = 'owner', D: Role = 'director', AC: Role = 'accountant', AD: Role = 'admin', PL: Role = 'project_lead', S: Role = 'staff'
const ALL: Role[] = [O, D, AC, AD, PL, S]

const METHODS = opts([['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['mobile_money', 'Mobile money'], ['other', 'Other']])

export const clients: ResourceDef = {
  key: 'clients', table: 'clients', title: 'Clients', singular: 'Client',
  orderBy: { column: 'name' },
  readRoles: [O, D, AC, AD, PL], createRoles: [O, AC, AD, PL], editRoles: [O, AC, AD, PL], importRoles: [O, AC, AD],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'organisation', label: 'Organisation', type: 'text', list: true },
    { name: 'type', label: 'Type', type: 'select', required: true, default: 'corporate', list: true,
      options: opts([['government', 'Government / public'], ['corporate', 'Corporate'], ['private_individual', 'Private individual'], ['other', 'Other']]) },
    { name: 'phone', label: 'Phone', type: 'text', list: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'tin', label: 'TIN', type: 'text' },
    { name: 'vat_number', label: 'VAT number', type: 'text' },
    { name: 'deducts_wht', label: 'Deducts WHT', type: 'boolean', default: false, list: true },
    { name: 'wht_category', label: 'WHT category', type: 'text', help: 'Required if the client deducts WHT, e.g. "services". Must match a WHT rate category in Settings.' },
    { name: 'is_vat_withholding_agent', label: 'VAT withholding agent', type: 'boolean', default: false },
    { name: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', min: 0, help: 'Leave blank for the standard terms in Settings.' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
  ],
}

export const referrers: ResourceDef = {
  key: 'referrers', table: 'referrers', title: 'Referrers and contacts', singular: 'Referrer',
  description: 'Who sends work to MeLiNS (D-012). Contact log and BD fees arrive in Phase B.',
  orderBy: { column: 'name' },
  readRoles: [O, D, AC, AD, PL], createRoles: [O, AC, AD, PL], editRoles: [O, AC, AD, PL], importRoles: [O, AC, AD],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'organisation', label: 'Organisation', type: 'text', list: true },
    { name: 'relationship', label: 'Relationship', type: 'select', required: true, default: 'other', list: true,
      options: opts([['mentor', 'Mentor'], ['consultant', 'Consultant'], ['contractor', 'Contractor'], ['architect', 'Architect'], ['past_client', 'Past client'], ['other', 'Other']]) },
    { name: 'phone', label: 'Phone', type: 'text', list: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'last_contact_date', label: 'Last contact', type: 'date', list: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
  ],
}

export const suppliers: ResourceDef = {
  key: 'suppliers', table: 'suppliers', title: 'Suppliers and subcontractors', singular: 'Supplier',
  description: 'Minimal in Phase A (D-011). TIN and Ghana Card are finance-restricted and entered separately.',
  orderBy: { column: 'name' },
  readRoles: [O, D, AC, AD, PL], createRoles: [O, AC, AD], editRoles: [O, AC, AD], importRoles: [O, AC, AD],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'type', label: 'Type', type: 'select', required: true, default: 'other', list: true,
      options: opts([['freelance_cad', 'Freelance CAD technician'], ['freelance_engineer', 'Freelance engineer'], ['equipment_hire', 'Equipment hire company'],
                     ['vehicle_hire', 'Vehicle hire / driver'], ['materials', 'Materials supplier'], ['other', 'Other']]) },
    { name: 'wht_category', label: 'WHT category', type: 'text', list: true, help: 'Must match a supplier WHT rate category in Settings.' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
  ],
}

export const accounts: ResourceDef = {
  key: 'accounts', table: 'accounts', title: 'Accounts', singular: 'Account',
  description: 'MeLiNS bank, mobile money and cash accounts. Only the last 4 digits of any number are stored.',
  orderBy: { column: 'name' },
  readRoles: [O, D, AC], createRoles: [O, AC], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true, help: 'e.g. "GCB operating", "MTN MoMo", "Petty cash"' },
    { name: 'type', label: 'Type', type: 'select', required: true, list: true,
      options: opts([['bank', 'Bank'], ['mobile_money', 'Mobile money'], ['petty_cash', 'Petty cash'], ['other', 'Other']]) },
    { name: 'institution', label: 'Institution', type: 'text', list: true },
    { name: 'last4', label: 'Last 4 digits', type: 'text', help: 'Never the full account number.' },
    { name: 'purpose', label: 'Purpose', type: 'select', required: true, list: true,
      options: opts([['operating', 'Operating'], ['collections', 'Collections'], ['payroll', 'Payroll'], ['reserve', 'Reserve / ring-fenced'], ['petty_cash', 'Petty cash']]) },
    { name: 'opening_balance', label: 'Opening balance', type: 'money', required: true, default: 0,
      help: 'The statement\'s closing balance on the day before the opening date (D-029).' },
    { name: 'opening_date', label: 'Balance at the start of', type: 'date', required: true, createOnly: true,
      help: 'Go-live: 1 Oct 2026, with the closing balance of 30 Sep 2026. Entries count from this date.' },
    { name: 'admin_may_post', label: 'Admin may post to it', type: 'boolean', default: false, list: true },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

export const staff: ResourceDef = {
  key: 'staff', table: 'staff', title: 'Staff', singular: 'Staff member',
  orderBy: { column: 'full_name' },
  readRoles: ALL, createRoles: [O], editRoles: [O], importRoles: [O],
  fields: [
    { name: 'full_name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'job_title', label: 'Job title', type: 'text', required: true, list: true },
    { name: 'budget_role_id', label: 'Budget role', type: 'lookup', required: true, lookup: lookups.budgetRole, list: true,
      help: 'Timesheet hours roll up by this role (D-014).' },
    { name: 'email', label: 'Email (log-in)', type: 'email' },
    { name: 'approver_staff_id', label: 'Approver', type: 'lookup', lookup: lookups.staff, list: true,
      help: 'Approves timesheets and leave (D-015). Blank only for the Managing Director.' },
    { name: 'billable_default', label: 'Time billable by default', type: 'boolean', default: true },
    { name: 'monthly_billable_target', label: 'Billable hours target / month', type: 'number', default: 100, min: 0 },
    { name: 'is_national_service', label: 'National service', type: 'boolean', default: false },
    { name: 'start_date', label: 'Start date', type: 'date', required: true, list: true },
    { name: 'end_date', label: 'End date', type: 'date' },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
  ],
}

export const staffCostHistory: ResourceDef = {
  key: 'staff_cost_history', table: 'staff_cost_history', title: 'Staff cost history', singular: 'Cost change',
  description: 'Never overwritten: a pay change adds a new dated row (brief §7.1).',
  orderBy: { column: 'effective_from', ascending: false },
  readRoles: [O, D, AC], createRoles: [O], editRoles: [], importRoles: [O],
  fields: [
    { name: 'staff_id', label: 'Staff member', type: 'lookup', required: true, lookup: lookups.staff, list: true },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true, list: true },
    { name: 'monthly_cost', label: 'Monthly cost to company', type: 'money', required: true, list: true },
    { name: 'basic_pay', label: 'Basic pay', type: 'money', list: true },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
}

const RETENTION_BASIS = opts([['net', 'Net (VAT-exclusive)'], ['gross', 'Gross']])

export const jobs: ResourceDef = {
  key: 'jobs', table: 'jobs', title: 'Jobs', singular: 'Job',
  description: 'New jobs get the next MEL number. Imported jobs keep their existing numbers (D-021).',
  orderBy: { column: 'job_number', ascending: false },
  readRoles: [O, D, AC, AD, PL], createRoles: [O, AD, PL], editRoles: [O, AD, PL], importRoles: [O, AD],
  importDefaults: { is_imported: true },
  fields: [
    { name: 'job_number', label: 'Job number', type: 'text', createOnly: true, list: true,
      help: 'Leave blank for a new job. For imported jobs, the existing number (e.g. MEL-2025-014).' },
    { name: 'title', label: 'Title', type: 'text', required: true, list: true },
    { name: 'client_id', label: 'Client', type: 'lookup', required: true, lookup: lookups.client, list: true },
    { name: 'referrer_id', label: 'Referred by', type: 'lookup', lookup: lookups.referrer },
    { name: 'job_type_id', label: 'Job type', type: 'lookup', lookup: lookups.jobType },
    { name: 'contract_mode', label: 'Contract mode', type: 'select', required: true, default: 'consultancy',
      options: opts([['consultancy', 'Consultancy'], ['design_build', 'Design and build']]) },
    { name: 'delivery_status', label: 'Delivery status', type: 'select', required: true, default: 'not_started', list: true,
      options: opts([['not_started', 'Not started'], ['in_progress', 'In progress'], ['on_hold', 'On hold'], ['under_review', 'Under review'], ['completed', 'Completed'], ['closed', 'Closed']]) },
    { name: 'fee_basis', label: 'Fee basis', type: 'select', required: true, default: 'lump_sum',
      options: opts([['lump_sum', 'Lump sum'], ['percent_of_construction', '% of construction cost'], ['monthly', 'Monthly'], ['time_based', 'Time-based']]) },
    { name: 'fee', label: 'Fee (D&B: contract sum)', type: 'money', list: true, help: 'Calculated when the fee basis is % of construction cost.' },
    { name: 'fee_percent', label: 'Fee % of construction cost', type: 'percent' },
    { name: 'construction_value', label: 'Construction value', type: 'money' },
    { name: 'retention_pct', label: 'Retention %', type: 'percent', default: 0, min: 0, max: 100 },
    { name: 'retention_basis', label: 'Retention basis', type: 'select', default: 'net', options: RETENTION_BASIS },
    { name: 'retention_release_terms', label: 'Retention release terms', type: 'text' },
    { name: 'retention_release_date', label: 'Expected retention release', type: 'date' },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'due_date', label: 'Due date', type: 'date', list: true },
    { name: 'percent_complete', label: '% complete', type: 'percent', default: 0, min: 0, max: 100 },
    { name: 'project_lead_staff_id', label: 'Project lead', type: 'lookup', lookup: lookups.staff },
    { name: 'is_goodwill', label: 'Goodwill / unpaid (still costed)', type: 'boolean', default: false },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

export const billingMilestones: ResourceDef = {
  key: 'billing_milestones', table: 'billing_milestones', title: 'Billing milestones', singular: 'Milestone',
  orderBy: { column: 'seq' },
  readRoles: [O, D, AC, AD, PL], createRoles: [O, AD, PL], editRoles: [O, AD, PL], importRoles: [O, AD],
  fields: [
    { name: 'job_id', label: 'Job', type: 'lookup', required: true, lookup: lookups.job, list: true, createOnly: true },
    { name: 'seq', label: 'Order', type: 'number', default: 1, list: true },
    { name: 'name', label: 'Milestone', type: 'text', required: true, list: true },
    { name: 'amount', label: 'Amount', type: 'money', list: true, help: 'Or give a % of the fee instead.' },
    { name: 'percent_of_fee', label: '% of fee', type: 'percent', min: 0, max: 100 },
    { name: 'trigger_description', label: 'Trigger', type: 'text' },
    { name: 'target_date', label: 'Target date', type: 'date', list: true },
    { name: 'status', label: 'Status', type: 'select', csv: false, list: true,
      options: opts([['pending', 'Pending'], ['reached', 'Reached'], ['invoiced', 'Invoiced'], ['paid', 'Paid']]),
      help: 'Owner or Project lead marks Reached; Invoiced and Paid follow the invoice.' },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
}

export const jobHourBudgets: ResourceDef = {
  key: 'job_hour_budgets', table: 'job_hour_budgets', title: 'Job hour budgets', singular: 'Hour budget',
  primaryKey: ['job_id', 'budget_role_id'],
  orderBy: { column: 'job_id' },
  readRoles: [O, D, AC, PL], createRoles: [O, PL], editRoles: [O, PL], importRoles: [O, PL],
  fields: [
    { name: 'job_id', label: 'Job', type: 'lookup', required: true, lookup: lookups.job, list: true, createOnly: true },
    { name: 'budget_role_id', label: 'Role', type: 'lookup', required: true, lookup: lookups.budgetRole, list: true, createOnly: true },
    { name: 'hours', label: 'Hours', type: 'number', required: true, min: 0, list: true },
  ],
}

export const jobContracts: ResourceDef = {
  key: 'job_contracts', table: 'job_contracts', title: 'Contracts register', singular: 'Contract document',
  orderBy: { column: 'doc_date', ascending: false },
  readRoles: [O, D, AC, AD, PL], createRoles: [O, AD, PL], editRoles: [O, AD, PL], importRoles: [O, AD],
  fields: [
    { name: 'job_id', label: 'Job', type: 'lookup', required: true, lookup: lookups.job, list: true },
    { name: 'doc_type', label: 'Document', type: 'select', required: true, list: true,
      options: opts([['appointment_letter', 'Appointment letter'], ['signed_agreement', 'Signed agreement'], ['letter_of_award', 'Letter of award'],
                     ['variation', 'Variation'], ['subcontract_agreement', 'Subcontract agreement'], ['other', 'Other']]) },
    { name: 'doc_date', label: 'Date', type: 'date', list: true },
    { name: 'parties', label: 'Parties', type: 'text' },
    { name: 'value', label: 'Value', type: 'money', list: true },
    { name: 'payment_terms', label: 'Payment terms', type: 'text' },
    { name: 'retention_terms', label: 'Retention terms', type: 'text' },
    { name: 'liability_cap', label: 'Liability cap', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
}

export const openingInvoices: ResourceDef = {
  key: 'opening_invoices', table: 'invoices', title: 'Opening receivables', singular: 'Opening invoice',
  description: 'Unpaid invoices issued before go-live (brief §10). They keep their numbers (D-021). For a part-paid invoice, enter what is still owed. New invoices are drafted on the Invoices screen.',
  orderBy: { column: 'invoice_number' },
  readRoles: [O, D, AC, AD], createRoles: [], editRoles: [], importRoles: [O, AC],
  importDefaults: { is_imported: true },
  listFilter: { is_imported: true },
  fields: [
    { name: 'invoice_number', label: 'Invoice number', type: 'text', required: true, list: true },
    { name: 'job_id', label: 'Job', type: 'lookup', required: true, lookup: lookups.job, list: true },
    { name: 'invoice_date', label: 'Invoice date', type: 'date', required: true, list: true },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', required: true, default: 'sent', list: true,
      options: opts([['approved', 'Approved (not yet sent)'], ['sent', 'Sent'], ['disputed', 'Disputed']]) },
    { name: 'net_total', label: 'Net', type: 'money', required: true },
    { name: 'tax_total', label: 'VAT and levies', type: 'money', default: 0 },
    { name: 'gross_total', label: 'Gross', type: 'money', required: true, list: true },
    { name: 'retention_amount', label: 'Retention deducted', type: 'money', default: 0 },
    { name: 'expected_wht', label: 'Expected WHT', type: 'money', default: 0 },
    { name: 'dispute_reason', label: 'Dispute reason', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
  extraListColumns: [{ name: 'outstanding', label: 'Outstanding', type: 'money' }],
}

const PAYMENT_SOURCE = opts([['company_account', 'Company account'], ['petty_cash', 'Petty cash'],
                             ['staff_out_of_pocket', 'Staff out of pocket'], ['supplier_payable', 'Supplier bill (pay later)']])

export const expenses: ResourceDef = {
  key: 'expenses', table: 'expenses', title: 'Expenses', singular: 'Expense',
  description: 'Enter the amount paid, VAT included. Admin entries go to the Accountant for review.',
  orderBy: { column: 'expense_date', ascending: false },
  readRoles: ALL, createRoles: [O, AC, AD, PL, S], editRoles: [O, AC, AD], importRoles: [O, AC, AD],
  fields: [
    { name: 'expense_date', label: 'Date', type: 'date', required: true, list: true, default: () => todayAccra() },
    { name: 'category_id', label: 'Category', type: 'lookup', required: true, lookup: lookups.category, list: true },
    { name: 'job_id', label: 'Job', type: 'lookup', lookup: lookups.job, help: 'Required for job direct costs.' },
    { name: 'supplier_id', label: 'Supplier', type: 'lookup', lookup: lookups.supplier },
    { name: 'description', label: 'Description', type: 'text', required: true, list: true },
    { name: 'amount', label: 'Amount paid (VAT incl.)', type: 'money', required: true, min: 0.01, list: true },
    { name: 'tax_code_id', label: 'Tax code', type: 'lookup', lookup: lookups.taxCode },
    { name: 'has_valid_vat_invoice', label: 'Valid VAT invoice received', type: 'boolean', default: false },
    { name: 'payment_source', label: 'Paid from', type: 'select', required: true, default: 'company_account', options: PAYMENT_SOURCE, list: true },
    { name: 'account_id', label: 'Account', type: 'lookup', lookup: lookups.account, help: 'For company account or petty cash.' },
    { name: 'staff_id', label: 'Staff member (out of pocket)', type: 'lookup', lookup: lookups.staff },
    { name: 'rechargeable', label: 'Rechargeable to client', type: 'boolean', default: false },
    { name: 'recharge_markup_pct', label: 'Recharge markup %', type: 'percent', default: 0, min: 0 },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
  extraListColumns: [{ name: 'review_status', label: 'Review', type: 'text' }],
}

export const recurringExpenses: ResourceDef = {
  key: 'recurring_expenses', table: 'recurring_expenses', title: 'Recurring expenses', singular: 'Recurring expense',
  description: 'Each due date creates a draft expense for Admin to confirm.',
  orderBy: { column: 'next_due_date' },
  readRoles: [O, D, AC, AD], createRoles: [O, AC, AD], editRoles: [O, AC, AD], importRoles: [O, AC, AD],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true, help: 'e.g. "Cleaner", "Internet"' },
    { name: 'category_id', label: 'Category', type: 'lookup', required: true, lookup: lookups.category, list: true },
    { name: 'supplier_id', label: 'Supplier', type: 'lookup', lookup: lookups.supplier },
    { name: 'job_id', label: 'Job', type: 'lookup', lookup: lookups.job },
    { name: 'expected_amount', label: 'Expected amount', type: 'money', required: true, min: 0.01, list: true },
    { name: 'frequency', label: 'Frequency', type: 'select', required: true, default: 'monthly', list: true,
      options: opts([['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']]) },
    { name: 'next_due_date', label: 'Next due', type: 'date', required: true, list: true },
    { name: 'payment_source', label: 'Paid from', type: 'select', required: true, default: 'company_account',
      options: PAYMENT_SOURCE.filter((o) => o.value !== 'staff_out_of_pocket') },
    { name: 'account_id', label: 'Usual account', type: 'lookup', lookup: lookups.account },
    { name: 'tax_code_id', label: 'Tax code', type: 'lookup', lookup: lookups.taxCode },
    { name: 'is_fixed_amount', label: 'Fixed amount', type: 'boolean', default: true },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
}

export const transfers: ResourceDef = {
  key: 'transfers', table: 'transfers', title: 'Account transfers', singular: 'Transfer',
  description: 'Money moved between MeLiNS accounts, or handed over by a director. Neither income nor cost.',
  orderBy: { column: 'transfer_date', ascending: false },
  readRoles: [O, D, AC, AD], createRoles: [O, AC, AD], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'transfer_date', label: 'Date', type: 'date', required: true, list: true, default: () => todayAccra() },
    { name: 'from_account_id', label: 'From account', type: 'lookup', lookup: lookups.account, list: true },
    { name: 'from_director_id', label: 'Or from director (client money held)', type: 'lookup', lookup: lookups.director, hiddenFor: [AD] },
    { name: 'to_account_id', label: 'To account', type: 'lookup', required: true, lookup: lookups.account, list: true },
    { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01, list: true },
    { name: 'reference', label: 'Reference', type: 'text' },
    { name: 'reason', label: 'Reason', type: 'text', list: true },
  ],
}

export const statutoryLines: ResourceDef = {
  key: 'statutory_lines', table: 'statutory_lines', title: 'Statutory obligations', singular: 'Statutory line',
  description: 'Enter opening arrears per type at setup (brief §7.6). Payroll and WHT lines are created automatically.',
  orderBy: { column: 'due_date' },
  readRoles: [O, D, AC], createRoles: [O, AC], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'type', label: 'Type', type: 'select', required: true, list: true,
      options: opts([['paye', 'PAYE'], ['bonus_paye', 'Bonus PAYE'], ['wht_directors_dividends', "WHT on directors' fees and dividends"],
                     ['ssnit_tier1', 'SSNIT Tier 1'], ['ssnit_tier2', 'SSNIT Tier 2'], ['vat', 'VAT return'], ['wht_remittance', 'WHT remittance'],
                     ['provisional_corporate_tax', 'Provisional corporate tax'], ['corporate_tax_return', 'Annual corporate tax return'], ['other', 'Other']]) },
    { name: 'is_opening_arrears', label: 'Opening arrears', type: 'boolean', default: false, list: true },
    { name: 'period_start', label: 'Period (first day)', type: 'date', list: true, help: 'Required unless it is opening arrears.' },
    { name: 'payee', label: 'Payee', type: 'text', help: 'Blank = the default payee for the type.' },
    { name: 'amount_due', label: 'Amount due', type: 'money', required: true, min: 0, list: true },
    { name: 'due_date', label: 'Due date', type: 'date', list: true, help: 'Blank = from the statutory calendar.' },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
}

export const directorTransactions: ResourceDef = {
  key: 'director_transactions', table: 'director_transactions', title: "Directors' current accounts", singular: 'Current-account entry',
  description: "Director's loans, capital introduced, and personal items paid by the company. Neither income nor cost.",
  orderBy: { column: 'txn_date', ascending: false },
  readRoles: [O, D, AC], createRoles: [O, AC], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'director_id', label: 'Director', type: 'lookup', required: true, lookup: lookups.director, list: true },
    { name: 'txn_date', label: 'Date', type: 'date', required: true, list: true },
    { name: 'type', label: 'Type', type: 'select', required: true, list: true,
      options: opts([['loan_in', "Director's loan to company"], ['capital_introduced', 'Capital introduced'],
                     ['personal_item_paid_by_company', 'Personal item paid by company'], ['other_in', 'Other (company owes director)'],
                     ['other_out', 'Other (director owes company)']]) },
    { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01, list: true },
    { name: 'account_id', label: 'Account', type: 'lookup', required: true, lookup: lookups.account },
    { name: 'description', label: 'Description', type: 'text', list: true },
    { name: 'reference', label: 'Reference', type: 'text' },
  ],
}

export const leaveEntitlements: ResourceDef = {
  key: 'leave_entitlements', table: 'leave_entitlements', title: 'Leave entitlements', singular: 'Entitlement',
  orderBy: { column: 'leave_year', ascending: false },
  readRoles: [O, D, AC, PL], createRoles: [O], editRoles: [O], importRoles: [O],
  fields: [
    { name: 'staff_id', label: 'Staff member', type: 'lookup', required: true, lookup: lookups.staff, list: true },
    { name: 'leave_type_id', label: 'Leave type', type: 'lookup', required: true, lookup: lookups.leaveType, list: true },
    { name: 'leave_year', label: 'Leave year', type: 'number', required: true, list: true },
    { name: 'entitled_days', label: 'Entitled days', type: 'number', required: true, min: 0, list: true },
    { name: 'carried_over_days', label: 'Carried over', type: 'number', default: 0, min: 0, list: true },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
}

export const publicHolidays: ResourceDef = {
  key: 'public_holidays', table: 'public_holidays', title: 'Public holidays', singular: 'Public holiday',
  description: 'Ghana public holidays. They extend the timesheet window and aren\'t leave days.',
  primaryKey: ['holiday_date'],
  orderBy: { column: 'holiday_date' },
  readRoles: ALL, createRoles: [O, AC], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'holiday_date', label: 'Date', type: 'date', required: true, list: true, createOnly: true },
    { name: 'name', label: 'Holiday', type: 'text', required: true, list: true },
  ],
}

export const whtRates: ResourceDef = {
  key: 'wht_rates', table: 'wht_rates', title: 'WHT rates', singular: 'WHT rate',
  description: 'Dated; confirm with the Accountant at setup. A change adds a new dated row.',
  orderBy: { column: 'effective_from', ascending: false },
  readRoles: ALL, createRoles: [O, AC], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'applies_to', label: 'Applies to', type: 'select', required: true, list: true,
      options: opts([['client', 'Clients deduct from MeLiNS'], ['supplier', 'MeLiNS deducts from suppliers'],
                     ['director_fee', "Directors' fees"], ['dividend', 'Dividends']]) },
    { name: 'category', label: 'Category', type: 'text', required: true, list: true, help: 'e.g. "services"; for directors\' fees and dividends use "default".' },
    { name: 'rate', label: 'Rate %', type: 'percent', fraction: true, required: true, min: 0, max: 100, list: true },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true, list: true },
  ],
}

export const expenseCategories: ResourceDef = {
  key: 'expense_categories', table: 'expense_categories', title: 'Expense categories', singular: 'Category',
  description: 'Two levels. Categories can be renamed but not deleted once used.',
  orderBy: { column: 'sort_order' },
  readRoles: ALL, createRoles: [O, AC], editRoles: [O, AC], importRoles: [O, AC],
  fields: [
    { name: 'parent_id', label: 'Group', type: 'lookup', lookup: lookups.category, list: true },
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'requires_job', label: 'Needs a job', type: 'boolean', default: false, list: true },
    { name: 'sort_order', label: 'Order', type: 'number', default: 0 },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
  ],
}

export const jobTypes: ResourceDef = {
  key: 'job_types', table: 'job_types', title: 'Job types', singular: 'Job type',
  orderBy: { column: 'sort_order' },
  readRoles: ALL, createRoles: [O], editRoles: [O], importRoles: [O],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'sort_order', label: 'Order', type: 'number', default: 0 },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true, list: true },
  ],
}

export const leaveTypes: ResourceDef = {
  key: 'leave_types', table: 'leave_types', title: 'Leave types', singular: 'Leave type',
  orderBy: { column: 'sort_order' },
  readRoles: ALL, createRoles: [O], editRoles: [O], importRoles: [O],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'is_paid', label: 'Paid', type: 'boolean', default: true, list: true },
    { name: 'uses_annual_balance', label: 'Uses annual balance', type: 'boolean', default: false, list: true },
    { name: 'requires_document', label: 'Needs a supporting document', type: 'boolean', default: false },
    { name: 'document_after_days', label: 'Document needed after (days)', type: 'number', min: 0 },
    { name: 'default_entitled_days', label: 'Default days per year', type: 'number', min: 0, list: true },
    { name: 'sort_order', label: 'Order', type: 'number', default: 0 },
    { name: 'is_active', label: 'Active', type: 'boolean', default: true },
  ],
}

export const staffLoans: ResourceDef = {
  key: 'staff_loans', table: 'staff_loans', title: 'Staff loans', singular: 'Staff loan',
  description: 'Issuing a loan is money out: prepared, approved by the Owner, then paid. Instalments are deducted through payroll.',
  orderBy: { column: 'created_at', ascending: false },
  readRoles: [O, D, AC], createRoles: [O, AC], editRoles: [O, AC], importRoles: [],
  fields: [
    { name: 'staff_id', label: 'Staff member', type: 'lookup', required: true, lookup: lookups.staff, list: true },
    { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01, list: true },
    { name: 'purpose', label: 'Purpose', type: 'text' },
    { name: 'monthly_instalment', label: 'Monthly instalment', type: 'money', required: true, min: 0.01, list: true },
    { name: 'first_deduction_month', label: 'First deduction month', type: 'date', help: 'First day of the month.' },
    { name: 'payment_date', label: 'Date paid out', type: 'date' },
    { name: 'account_id', label: 'Paid from account', type: 'lookup', lookup: lookups.account },
    { name: 'method', label: 'Method', type: 'select', options: METHODS },
    { name: 'reference', label: 'Reference', type: 'text' },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
  extraListColumns: [{ name: 'status', label: 'Status', type: 'text' }],
}

export const whtCertificates: ResourceDef = {
  key: 'wht_certificates', table: 'wht_certificates', title: 'WHT certificates', singular: 'WHT certificate',
  description: 'Created as Expected when a client pays with WHT deducted; flagged if not received within 30 days.',
  orderBy: { column: 'expected_by' },
  readRoles: [O, D, AC, AD], createRoles: [O, AC, AD], editRoles: [O, AC, AD], importRoles: [O, AC],
  fields: [
    { name: 'client_id', label: 'Client', type: 'lookup', required: true, lookup: lookups.client, list: true },
    { name: 'amount', label: 'WHT amount', type: 'money', required: true, min: 0, list: true },
    { name: 'certificate_number', label: 'Certificate number', type: 'text', list: true },
    { name: 'expected_by', label: 'Expected by', type: 'date', list: true },
    { name: 'date_received', label: 'Date received', type: 'date', list: true },
    { name: 'status', label: 'Status', type: 'select', required: true, default: 'expected', list: true,
      options: opts([['expected', 'Expected'], ['received', 'Received'], ['claimed', 'Claimed against tax'], ['cancelled', 'Cancelled']]) },
    { name: 'notes', label: 'Notes', type: 'text' },
  ],
}

export const RESOURCES: ResourceDef[] = [
  clients, referrers, suppliers, jobs, billingMilestones, jobHourBudgets, jobContracts,
  openingInvoices, whtCertificates, expenses, recurringExpenses, transfers, accounts, statutoryLines, directorTransactions,
  staffLoans, staff, staffCostHistory, leaveEntitlements, leaveTypes, publicHolidays, whtRates,
  expenseCategories, jobTypes,
]

export const resourceByKey = (key: string) => RESOURCES.find((r) => r.key === key)
