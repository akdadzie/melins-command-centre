import type { Database } from '../lib/database.types'

export type Role = Database['public']['Enums']['app_role']

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  director: 'Director (view-only)',
  accountant: 'Accountant',
  admin: 'Admin',
  project_lead: 'Project lead',
  staff: 'Staff',
}

/** Roles that can't use the system until their second factor is verified (brief §3, A-005). */
export const MFA_REQUIRED: Role[] = ['owner', 'director', 'accountant']

/** Directors never write (brief §4); every action button checks this. */
export function canWrite(role: Role | null): boolean {
  return role !== null && role !== 'director'
}
