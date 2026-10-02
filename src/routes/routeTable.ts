// Every view and its route (brief §5). The database enforces the same rules
// with RLS; this table decides navigation and the "No access" page.
// Directors can open every route the Owner can, read-only, except Settings.
import type { Role } from '../auth/roles'

export type Phase = 'A' | 'B' | 'C'

export interface RouteDef {
  path: string
  title: string
  roles: Role[]
  phase: Phase
  /** Shown in the main navigation under this group. */
  nav?: 'Money' | 'Work' | 'People' | 'Records' | 'Admin'
}

const ALL: Role[] = ['owner', 'director', 'accountant', 'admin', 'project_lead', 'staff']
const OD: Role[] = ['owner', 'director']

export const ROUTES: RouteDef[] = [
  { path: '/', title: 'Home', roles: ALL, phase: 'A' },
  { path: '/notifications', title: 'Notifications', roles: ALL, phase: 'A' },
  { path: '/me', title: 'My profile and 2FA', roles: ALL, phase: 'A' },

  { path: '/accounts', title: 'Accounts and balances', roles: [...OD, 'accountant'], phase: 'A', nav: 'Money' },
  { path: '/accounts/transfers', title: 'Account transfers', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/accounts/reconciliations', title: 'Reconciliations', roles: [...OD, 'accountant'], phase: 'A', nav: 'Money' },
  { path: '/accounts/:id', title: 'Account detail', roles: [...OD, 'accountant'], phase: 'A' },
  { path: '/invoices', title: 'Invoices', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A', nav: 'Money' },
  { path: '/invoices/ready', title: 'Ready to invoice', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/invoices/retention', title: 'Retention held by clients', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/invoices/adjustments', title: 'Credit notes, disputes and write-offs', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/invoices/:number', title: 'Invoice', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A' },
  { path: '/receipts', title: 'Payments received', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/receipts/new', title: 'Record a payment', roles: [...OD, 'accountant', 'admin'], phase: 'A' },
  { path: '/receipts/wht', title: 'WHT certificates', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/expenses', title: 'Expenses', roles: ALL, phase: 'A', nav: 'Money' },
  { path: '/expenses/recurring', title: 'Recurring expenses', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/expenses/prepayments', title: 'Prepayments', roles: [...OD, 'accountant'], phase: 'C', nav: 'Money' },
  { path: '/payments-out', title: 'Payments out', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/staff-payments', title: 'Staff payments', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/advances', title: 'Cash advances', roles: ALL, phase: 'B', nav: 'Money' },
  { path: '/staff-loans', title: 'Staff loans', roles: [...OD, 'accountant', 'admin'], phase: 'A', nav: 'Money' },
  { path: '/payroll', title: 'Payroll runs', roles: [...OD, 'accountant'], phase: 'A', nav: 'Money' },
  { path: '/payroll/:month', title: 'Payroll run', roles: [...OD, 'accountant'], phase: 'A' },
  { path: '/directors', title: "Directors' current accounts", roles: [...OD, 'accountant'], phase: 'A', nav: 'Money' },
  { path: '/directors/:id', title: "Director's current account", roles: [...OD, 'accountant'], phase: 'A' },
  { path: '/tax/statutory', title: 'Tax and statutory ledger', roles: [...OD, 'accountant'], phase: 'A', nav: 'Money' },
  { path: '/tax/vat/:month', title: 'VAT workings', roles: [...OD, 'accountant'], phase: 'A' },

  { path: '/me/payslips', title: 'My payslips', roles: ALL, phase: 'A' },
  { path: '/me/payslips/:id', title: 'Payslip', roles: ALL, phase: 'A' },
  { path: '/me/leave', title: 'My leave', roles: ['owner', 'accountant', 'admin', 'project_lead', 'staff'], phase: 'A', nav: 'People' },
  { path: '/leave', title: 'Leave requests', roles: [...OD, 'accountant', 'project_lead'], phase: 'A', nav: 'People' },
  { path: '/leave/calendar', title: 'Leave calendar', roles: ALL, phase: 'A', nav: 'People' },
  { path: '/leave/balances', title: 'Leave balances', roles: [...OD, 'accountant', 'project_lead'], phase: 'A', nav: 'People' },

  { path: '/pipeline', title: 'Pipeline', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'B', nav: 'Work' },
  { path: '/pipeline/new', title: 'Log a lead', roles: ALL.filter((r) => r !== 'director'), phase: 'B' },
  { path: '/pipeline/tenders', title: 'Tender costs and bonds', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'C', nav: 'Work' },
  { path: '/pipeline/:id', title: 'Lead', roles: [...OD, 'admin', 'project_lead'], phase: 'B' },
  { path: '/clients', title: 'Clients', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A', nav: 'Work' },
  { path: '/clients/:id', title: 'Client', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A' },
  { path: '/referrers', title: 'Referrers and contacts', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A', nav: 'Work' },
  { path: '/referrers/:id', title: 'Referrer', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A' },
  { path: '/jobs', title: 'Jobs', roles: ALL, phase: 'A', nav: 'Work' },
  { path: '/jobs/:number', title: 'Job', roles: ALL, phase: 'A' },
  { path: '/tasks', title: 'Tasks', roles: [...OD, 'project_lead', 'staff'], phase: 'B', nav: 'Work' },
  { path: '/timesheet', title: 'Timesheet', roles: ['owner', 'project_lead', 'staff', 'admin'], phase: 'A', nav: 'People' },
  { path: '/timesheet/approvals', title: 'Timesheet approvals', roles: [...OD, 'project_lead'], phase: 'A', nav: 'People' },
  { path: '/team', title: 'Team workload and utilisation', roles: [...OD, 'accountant', 'project_lead'], phase: 'A', nav: 'People' },
  { path: '/team/staff', title: 'Staff and cost history', roles: [...OD, 'accountant', 'project_lead'], phase: 'A', nav: 'People' },
  { path: '/trips', title: 'Trips and site visits', roles: ALL, phase: 'B', nav: 'Work' },
  { path: '/suppliers', title: 'Suppliers', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'A', nav: 'Work' },
  { path: '/subcontracts', title: 'Subcontract packages', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'B', nav: 'Work' },
  { path: '/hire', title: 'Hire records', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'B', nav: 'Work' },

  { path: '/overheads', title: 'Overheads: budget vs actual', roles: [...OD, 'accountant'], phase: 'C', nav: 'Records' },
  { path: '/commitments', title: 'Commitments, provisions and bonus', roles: [...OD, 'accountant'], phase: 'C', nav: 'Records' },
  { path: '/reports', title: 'Reports', roles: [...OD, 'accountant'], phase: 'B', nav: 'Records' },
  { path: '/reports/monthly', title: 'Monthly summary', roles: [...OD, 'accountant'], phase: 'A', nav: 'Records' },
  { path: '/assets', title: 'Asset register', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'C', nav: 'Records' },
  { path: '/assets/:tag', title: 'Asset', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'C' },
  { path: '/compliance', title: 'Compliance documents', roles: [...OD, 'accountant', 'admin', 'project_lead'], phase: 'C', nav: 'Records' },
  { path: '/close/:month', title: 'Month close', roles: [...OD, 'accountant', 'admin'], phase: 'A' },
  { path: '/import', title: 'Import and export', roles: ['owner', 'director', 'accountant', 'admin', 'project_lead'], phase: 'A', nav: 'Admin' },
  { path: '/settings', title: 'Settings', roles: ['owner', 'accountant'], phase: 'A', nav: 'Admin' },
]

export function canOpen(route: RouteDef, role: Role | null): boolean {
  return role !== null && route.roles.includes(role)
}
