// Go-live (DECISIONS D-029): opening balances are as at 30 Sep 2026, so
// October 2026 is the first month run, and closed, in the system.
export const GO_LIVE_MONTH = '2026-10-01'

/** 'YYYY-MM-01' of the month before the one containing iso. */
export function previousMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 10)
}

/** The month to close by default: last month, but never before go-live. */
export function defaultCloseMonth(todayIso: string): string {
  const m = previousMonth(todayIso)
  return m < GO_LIVE_MONTH ? GO_LIVE_MONTH : m
}
