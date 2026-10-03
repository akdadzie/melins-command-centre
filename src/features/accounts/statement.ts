// Reads a bank or mobile money statement exported as CSV (A-039). Until the
// Prudential Bank and MTN MoMo samples arrive (D-025), any statement whose heading row
// names a date, a description and either an amount or debit/credit columns can
// be read. Statements often have a few lines of account details above the
// headings, so the heading row is found, not assumed. Pure; unit-tested.
import Papa from 'papaparse'
import { parseDate, parseMoney } from '../../lib/format'

export interface StatementLine {
  line_date: string
  description: string | null
  reference: string | null
  /** + credit (money in), − debit */
  amount: number
  running_balance: number | null
}

export interface ParsedStatement {
  lines: StatementLine[]
  errors: string[]
  /** Which heading each part was read from, to show the user. */
  columns: Partial<Record<'date' | 'description' | 'reference' | 'amount' | 'debit' | 'credit' | 'balance', string>>
}

const PATTERNS = {
  date: /^(txn |transaction |posting |value |trans )?date$/,
  description: /^(description|narration|narrative|details|particulars|transaction details|remarks)$/,
  reference: /^(reference|ref|ref no|reference no|cheque no|chq no|transaction id|trans id|id)$/,
  amount: /^(amount|amount ghs|amount \(ghs\)|transaction amount)$/,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out|dr|debit amount)$/,
  credit: /^(credit|credits|deposit|deposits|lodgement|money in|paid in|cr|credit amount)$/,
  balance: /^(balance|running balance|closing balance|book balance|balance ghs)$/,
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[_.:]+/g, ' ').replace(/\s+/g, ' ')

function findColumns(row: string[]) {
  const cols: Partial<Record<keyof typeof PATTERNS, number>> = {}
  row.forEach((cell, i) => {
    const h = norm(cell)
    for (const [k, re] of Object.entries(PATTERNS) as [keyof typeof PATTERNS, RegExp][]) {
      if (cols[k] === undefined && re.test(h)) { cols[k] = i; break }
    }
  })
  return cols
}

/** Money in a statement cell: blank is zero; "1,250.00 CR" / "DR" suffixes are honoured. */
function cellMoney(raw: string | undefined): number | null {
  const s = (raw ?? '').trim()
  if (s === '' || s === '-') return 0
  const m = /^(.*?)\s*(CR|DR)$/i.exec(s)
  const n = parseMoney(m ? m[1] : s)
  if (n === null) return null
  return m && m[2].toUpperCase() === 'DR' ? -Math.abs(n) : n
}

export function parseStatementCsv(text: string): ParsedStatement {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data
  const errors: string[] = []
  const headerIndex = rows.findIndex((r) => {
    const c = findColumns(r)
    return c.date !== undefined && (c.amount !== undefined || (c.debit !== undefined && c.credit !== undefined))
  })
  if (headerIndex < 0) {
    return { lines: [], columns: {}, errors: ['No heading row found. The statement needs a Date column and either an Amount column or Debit and Credit columns.'] }
  }
  const header = rows[headerIndex]
  const c = findColumns(header)
  const columns: ParsedStatement['columns'] = {}
  for (const k of Object.keys(c) as (keyof typeof c)[]) columns[k] = String(header[c[k]!]).trim()

  const lines: StatementLine[] = []
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const rowNo = headerIndex + i + 2
    const rawDate = (r[c.date!] ?? '').trim()
    const desc = c.description !== undefined ? (r[c.description] ?? '').trim() : ''
    // Opening / closing balance rows and totals carry no transaction.
    if (/^(opening|closing|balance b\/?f|balance c\/?f|total)/i.test(desc) || /^(total|opening|closing)/i.test(rawDate)) return
    if (rawDate === '' && r.every((x) => (x ?? '').trim() === '')) return
    const date = parseDate(rawDate)
    if (!date) { errors.push(`Line ${rowNo}: "${rawDate}" isn't a date (use DD/MM/YYYY).`); return }
    let amount: number | null
    if (c.amount !== undefined) amount = cellMoney(r[c.amount])
    else {
      const dr = cellMoney(r[c.debit!]); const cr = cellMoney(r[c.credit!])
      amount = dr === null || cr === null ? null : Math.abs(cr) - Math.abs(dr)
    }
    if (amount === null) { errors.push(`Line ${rowNo}: the amount isn't a number.`); return }
    if (amount === 0) return
    const bal = c.balance !== undefined ? cellMoney(r[c.balance]) : null
    lines.push({
      line_date: date,
      description: desc || null,
      reference: c.reference !== undefined ? (r[c.reference] ?? '').trim() || null : null,
      amount: Math.round(amount * 100) / 100,
      running_balance: c.balance !== undefined && (r[c.balance] ?? '').trim() !== '' ? bal : null,
    })
  })
  return { lines, errors, columns }
}

/** Ledger entries that could be this statement line: same amount, within a week, not already matched. */
export function suggestMatches<T extends { entry_date: string; amount: number; key: string }>(
  line: { line_date: string; amount: number }, entries: T[], taken: Set<string>, days = 7,
): T[] {
  const t = Date.parse(line.line_date)
  return entries
    .filter((e) => !taken.has(e.key) && Math.abs(Number(e.amount) - line.amount) < 0.005
      && Math.abs(Date.parse(e.entry_date) - t) <= days * 86_400_000)
    .sort((a, b) => Math.abs(Date.parse(a.entry_date) - t) - Math.abs(Date.parse(b.entry_date) - t))
}
