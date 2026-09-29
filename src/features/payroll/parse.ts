// Reads the payroll spreadsheet (exported as CSV, one file per sheet) using a
// column map, and matches each row to a staff member (D-022, D-023). Pure;
// the tests use a synthetic sheet with the May 2026 workbook's layout.
import Papa from 'papaparse'
import { parseMoney } from '../../lib/format'

export const PAYROLL_FIELDS = [
  'basic', 'taxable_allowances', 'bonus', 'gross', 'ssnit_employee', 'pf_employee', 'taxable_income', 'paye',
  'bonus_paye', 'post_tax_allowances', 'net_pay', 'loan_deduction', 'advance_recovery', 'other_deductions',
  'bank_amount', 'ssnit_employer', 'pf_employer', 'sheet_cost_to_company',
] as const
export type PayrollField = typeof PAYROLL_FIELDS[number]

export const FIELD_LABELS: Record<PayrollField, string> = {
  basic: 'Basic', taxable_allowances: 'Taxable allowances', bonus: 'Bonus (in gross)', gross: 'Gross pay',
  ssnit_employee: "SSF employee's contribution", pf_employee: "PF employee's contribution (Tier 3)", taxable_income: 'Taxable income',
  paye: 'PAYE', bonus_paye: 'Bonus PAYE', post_tax_allowances: 'Allowances paid after tax', net_pay: 'Net pay',
  loan_deduction: 'Loan deductions', advance_recovery: 'Advance recovery', other_deductions: 'Other deductions',
  bank_amount: 'Bank amount', ssnit_employer: "Employer's SSF", pf_employer: "Employer's PF", sheet_cost_to_company: 'Total cost to company',
}

export interface ColumnMap {
  /** 1-based row holding the column headings. */
  header_row: number
  /** Column with the person's name. */
  name: string
  /** Field -> one column letter, or several to add up (e.g. allowances). */
  fields: Partial<Record<PayrollField, string | string[]>>
}

/** The May 2026 "Staff " sheet (header row 14; D-023). */
export const DEFAULT_STAFF_MAP: ColumnMap = {
  header_row: 14,
  name: 'B',
  fields: {
    basic: 'D', taxable_allowances: ['E', 'F', 'G'], bonus: 'H', gross: 'I', ssnit_employee: 'J', pf_employee: 'K',
    taxable_income: 'L', paye: 'R', ssnit_employer: 'T', pf_employer: 'U', post_tax_allowances: ['W', 'X', 'Y', 'Z', 'AA'],
    net_pay: 'AB', loan_deduction: 'AC', bank_amount: 'AD', sheet_cost_to_company: 'AE',
  },
}

/** A = 0, B = 1, …, Z = 25, AA = 26. */
export function colIndex(letters: string): number {
  const s = letters.trim().toUpperCase()
  if (!/^[A-Z]{1,3}$/.test(s)) throw new Error(`"${letters}" is not a column letter`)
  return [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1
}

export interface SheetLine {
  row: number
  name: string
  values: Record<PayrollField, number>
  /** Heading -> amount for the columns summed into taxable / post-tax allowances. */
  taxableDetail: Record<string, number>
  postTaxDetail: Record<string, number>
}

export interface SheetResult {
  lines: SheetLine[]
  totals: Partial<Record<PayrollField, number>> | null
  errors: string[]
}

/** Spreadsheet cells: "1,234.50", "-" or blank (zero), "(12.00)". */
function amount(cell: string | undefined): number | null {
  const t = (cell ?? '').trim()
  if (t === '' || t === '-' || t === '–') return 0
  return parseMoney(t)
}

export function parsePayrollCsv(text: string, map: ColumnMap): SheetResult {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false }).data
  const errors: string[] = []
  const nameCol = colIndex(map.name)
  const headers = rows[map.header_row - 1] ?? []
  if (!headers.length) return { lines: [], totals: null, errors: [`Row ${map.header_row} (the heading row) is empty: check the column map.`] }

  const cols = Object.fromEntries(Object.entries(map.fields).map(([f, v]) =>
    [f, (Array.isArray(v) ? v : [v!]).map(colIndex)])) as Partial<Record<PayrollField, number[]>>

  const read = (cells: string[], rowNo: number) => {
    const values = Object.fromEntries(PAYROLL_FIELDS.map((f) => [f, 0])) as Record<PayrollField, number>
    const detail = { taxable_allowances: {} as Record<string, number>, post_tax_allowances: {} as Record<string, number> }
    for (const [field, idxs] of Object.entries(cols) as [PayrollField, number[]][]) {
      let sum = 0
      for (const i of idxs) {
        const v = amount(cells[i])
        if (v === null) { errors.push(`Row ${rowNo}, column ${headers[i] || i + 1}: "${cells[i]}" is not a number`); continue }
        sum += v
        if ((field === 'taxable_allowances' || field === 'post_tax_allowances') && v !== 0) {
          detail[field][(headers[i] || `Column ${i + 1}`).trim()] = v
        }
      }
      values[field] = Math.round(sum * 100) / 100
    }
    return { values, detail }
  }

  const lines: SheetLine[] = []
  let totals: SheetResult['totals'] = null
  for (let r = map.header_row; r < rows.length; r++) {
    const cells = rows[r]
    const rowNo = r + 1
    const first = (cells[0] ?? '').trim()
    const name = (cells[nameCol] ?? '').trim()
    if (/^total/i.test(first) || /^total/i.test(name)) {
      totals = read(cells, rowNo).values
      break
    }
    if (!name) continue
    const { values, detail } = read(cells, rowNo)
    lines.push({ row: rowNo, name, values, taxableDetail: detail.taxable_allowances, postTaxDetail: detail.post_tax_allowances })
  }
  if (lines.length === 0) errors.push('No staff rows found under the heading row.')
  if (!totals) errors.push('No "Total" row found, so the sheet totals can\'t be checked.')
  return { lines, totals, errors }
}

export interface StaffRef { id: string; full_name: string }

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)

/**
 * Sheet names are often fuller than staff records ("Ernest Doe Kwaku Gbadago"
 * vs "Ernest Gbadago"): match exactly, else when every word of exactly one
 * staff name appears in the sheet name. Anything else is left for a person.
 */
export function matchStaff(sheetName: string, staff: StaffRef[]): StaffRef | null {
  const exact = staff.filter((s) => s.full_name.trim().toLowerCase() === sheetName.trim().toLowerCase())
  if (exact.length === 1) return exact[0]
  const words = new Set(tokens(sheetName))
  const subset = staff.filter((s) => tokens(s.full_name).every((t) => words.has(t)))
  return subset.length === 1 ? subset[0] : null
}

export function addTotals(a: SheetResult['totals'], b: SheetResult['totals']): SheetResult['totals'] {
  if (!a) return b
  if (!b) return a
  const out: Partial<Record<PayrollField, number>> = { ...a }
  for (const [k, v] of Object.entries(b) as [PayrollField, number][]) out[k] = Math.round(((out[k] ?? 0) + v) * 100) / 100
  return out
}
