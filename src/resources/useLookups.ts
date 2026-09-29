import { useQueries } from '@tanstack/react-query'
import { db } from '../lib/supabase'
import { buildLookupIndex, type LookupIndex } from './coerce'
import type { FieldDef, Lookup, Row } from './types'

export async function fetchLookupRows(lk: Lookup): Promise<Row[]> {
  let q = db.from(lk.source).select(lk.select).limit(5000)
  for (const [col, val] of Object.entries(lk.filter ?? {})) q = q.eq(col, val)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as Row[]
}

/** Loads every lookup list a set of fields needs. Lists the role can't read come back empty. */
export function useLookupIndexes(fields: FieldDef[]) {
  const lookupFields = fields.filter((f) => f.type === 'lookup' && f.lookup)
  const results = useQueries({
    queries: lookupFields.map((f) => ({
      queryKey: ['lookup', f.lookup!.source, f.lookup!.select, f.lookup!.filter],
      queryFn: () => fetchLookupRows(f.lookup!),
      staleTime: 60_000,
    })),
  })
  const indexes: Record<string, LookupIndex> = {}
  const options: Record<string, { value: string; label: string }[]> = {}
  lookupFields.forEach((f, i) => {
    const rows = results[i].data ?? []
    indexes[f.name] = buildLookupIndex(rows, f)
    options[f.name] = rows
      .map((r) => ({ value: String(r.id), label: f.lookup!.label(r) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })
  return {
    indexes,
    options,
    loading: results.some((r) => r.isLoading),
    error: results.find((r) => r.error)?.error as Error | undefined,
  }
}

/** Database errors in words a user can act on. Trigger messages are already written for people. */
export function friendlyError(err: { message?: string; code?: string } | null | undefined): string {
  if (!err) return ''
  const m = err.message ?? String(err)
  if (/row-level security|permission denied for/i.test(m)) return 'You don\'t have permission to do that.'
  if (/duplicate key/i.test(m)) return 'That already exists (a record with the same key is already saved).'
  if (/violates foreign key/i.test(m)) return 'It refers to, or is used by, another record, so this change isn\'t allowed.'
  if (/violates check constraint/i.test(m)) return 'Some values aren\'t allowed together. Check the required combinations (for example, an account for company payments).'
  return m
}
