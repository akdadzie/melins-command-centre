// Records the sections create and later sections use (one worker, one run).
import { as, ok } from './session'

export const ctx = {
  accounts: {} as Record<'bank' | 'momo' | 'petty' | 'reserve', string>,
  tax: {} as Record<'standard' | 'noVat', string>,
  clients: {} as Record<'acme' | 'private', string>,
  supplier: '',
  jobs: {} as Record<'office' | 'house', string>,
  invoices: {} as Record<string, string>,
  todaySettingsId: '',
  recurringBefore: 0,
}

const categories = new Map<string, string>()
export async function cat(name: string): Promise<string> {
  if (!categories.has(name)) {
    const owner = await as('owner')
    const rows = await ok(owner.from('expense_categories').select('id').eq('name', name), `category ${name}`)
    if (!rows?.length) throw new Error(`No expense category "${name}"`)
    categories.set(name, rows[0].id)
  }
  return categories.get(name)!
}

export const leaveType = async (name: string): Promise<string> => {
  const owner = await as('owner')
  const rows = await ok(owner.from('leave_types').select('id').eq('name', name), `leave type ${name}`)
  return rows![0].id
}

export const addDays = (d: string, n: number): string => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
export const monthStart = (d: string): string => `${d.slice(0, 7)}-01`
export const addMonths = (d: string, n: number): string => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCMonth(x.getUTCMonth() + n)
  return x.toISOString().slice(0, 10)
}
