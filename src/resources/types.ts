import type { Role } from '../auth/roles'

export type FieldType =
  | 'text' | 'textarea' | 'email' | 'number' | 'money' | 'percent' | 'date' | 'boolean' | 'select' | 'lookup'

export interface Option { value: string; label: string }

/** A foreign key picked by a human-readable label (and matched by label in CSV). */
export interface Lookup {
  /** Table or view the current role can read, e.g. 'clients' or 'account_picker' for accounts. */
  source: string
  /** Columns to fetch; must include id and whatever label() uses. */
  select: string
  /** Label shown in pickers and written to CSV exports. */
  label: (row: Record<string, unknown>) => string
  /** Other strings a CSV cell may use for this row (e.g. a job number or a short name). */
  aliases?: (row: Record<string, unknown>) => string[]
  filter?: Record<string, string | number | boolean>
}

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: Option[]
  lookup?: Lookup
  help?: string
  default?: unknown | (() => unknown)
  /** Show in list tables (default: first few fields). */
  list?: boolean
  /** Include in CSV template / import (default true). */
  csv?: boolean
  /** Only settable when creating. */
  createOnly?: boolean
  /** Hide from these roles in forms and exports (the database also enforces access). */
  hiddenFor?: Role[]
  min?: number
  max?: number
  /** percent fields stored as a fraction (7.5% -> 0.075), e.g. tax and WHT rates. */
  fraction?: boolean
}

export interface ResourceDef {
  key: string
  table: string
  title: string
  singular: string
  description?: string
  fields: FieldDef[]
  /** Only rows matching these values are listed/exported by this screen. */
  listFilter?: Record<string, string | number | boolean>
  /** Primary key columns (default ['id']). */
  primaryKey?: string[]
  orderBy: { column: string; ascending?: boolean }
  readRoles: Role[]
  createRoles: Role[]
  editRoles: Role[]
  importRoles: Role[]
  /** Values added to every imported row (e.g. is_imported = true). */
  importDefaults?: Record<string, unknown>
  /** Values added to every row created from the form. */
  createDefaults?: Record<string, unknown>
  /** Extra read-only columns shown in the list (computed by the database). */
  extraListColumns?: { name: string; label: string; type: FieldType }[]
}

export type Row = Record<string, unknown>
