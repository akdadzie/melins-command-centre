// Display and parsing rules from brief §3: GHS with thousands separators,
// dates DD MMM YYYY, Africa/Accra.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatMoney(value: number | string | null | undefined, withCurrency = true): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  const s = n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return withCurrency ? `GHS ${s}` : s
}

/** '2026-09-28' -> '28 Sep 2026' */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return value
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** Today in Africa/Accra as YYYY-MM-DD. */
export function todayAccra(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra' }).format(new Date())
}

/** Accepts "1,234.50", "GHS 1,234", "(250.00)" for negatives. Returns null if not a number. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  let s = input.trim()
  if (s === '') return null
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  s = s.replace(/^GHS\s*/i, '').replace(/,/g, '').trim()
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1) }
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return negative ? -n : n
}

/**
 * Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY and "28 Sep 2026" / "28-Sep-26".
 * Returns YYYY-MM-DD, or null if it isn't a real date. Never guesses US order.
 */
export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null
  const s = input.trim()
  let y: number, mo: number, d: number
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3] }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3] }
  else if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/.exec(s))) {
    d = +m[1]
    mo = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase()) + 1
    y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    if (mo === 0) return null
  } else return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseBoolean(input: string | boolean | null | undefined): boolean | null {
  if (typeof input === 'boolean') return input
  if (input === null || input === undefined) return null
  const s = input.trim().toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0', ''].includes(s)) return s === '' ? null : false
  return null
}
