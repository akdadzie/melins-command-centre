// Offline-first saving for timesheet entries (brief §3: "If saving fails, keep
// the entry on the device and retry automatically"; A-001). Each entry has a
// client_ref made on the phone, and the database ignores a second insert with
// the same ref, so a retry after a lost response never duplicates an entry.

export interface EntryPayload {
  client_ref: string
  staff_id: string
  work_date: string
  category: 'job' | 'internal' | 'business_development' | 'goodwill'
  job_id: string | null
  hours: number
  description: string | null
  late_reason: string | null
}

export interface QueuedEntry {
  payload: EntryPayload
  queuedAt: string
  /** 'pending' = will retry; 'rejected' = the database refused it (reason shown, not retried). */
  state: 'pending' | 'rejected'
  error?: string
  /** Label for the list while it's unsent (job name etc.). */
  label: string
}

export type SendResult = { ok: true } | { ok: false; network: true } | { ok: false; network: false; message: string }

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class TimesheetQueue {
  constructor(private store: KeyValueStore, private key: string) {}

  list(): QueuedEntry[] {
    try { return JSON.parse(this.store.getItem(this.key) ?? '[]') as QueuedEntry[] } catch { return [] }
  }

  private save(items: QueuedEntry[]) { this.store.setItem(this.key, JSON.stringify(items)) }

  add(payload: EntryPayload, label: string, now = new Date().toISOString()) {
    this.save([...this.list().filter((q) => q.payload.client_ref !== payload.client_ref), { payload, label, queuedAt: now, state: 'pending' }])
  }

  remove(ref: string) { this.save(this.list().filter((q) => q.payload.client_ref !== ref)) }

  retry(ref: string) {
    this.save(this.list().map((q) => (q.payload.client_ref === ref ? { ...q, state: 'pending', error: undefined } : q)))
  }

  /**
   * Sends pending entries in order. Stops at the first network failure (the
   * rest would fail too); a refusal is kept with its reason and skipped.
   */
  async flush(send: (p: EntryPayload) => Promise<SendResult>): Promise<{ sent: number; rejected: number; offline: boolean }> {
    let sent = 0, rejected = 0
    for (const item of this.list().filter((q) => q.state === 'pending')) {
      const res = await send(item.payload)
      if (res.ok) { this.remove(item.payload.client_ref); sent++; continue }
      if (res.network) return { sent, rejected, offline: true }
      this.save(this.list().map((q) => (q.payload.client_ref === item.payload.client_ref ? { ...q, state: 'rejected', error: res.message } : q)))
      rejected++
    }
    return { sent, rejected, offline: false }
  }
}

/** Is this a lost connection (retry later) rather than the server refusing the entry? */
export function isNetworkError(err: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!err) return false
  if (err.code && err.code.length > 0) return false          // Postgres / PostgREST answered
  return /failed to fetch|network|load failed|timeout|offline|fetch/i.test(err.message ?? '') || err.status === 0
}

// ---------------------------------------------------------------------------
// The entry window (brief §4): days 0-3 the person, then the Project lead to
// day 10, then only the Owner. Working days skip weekends and public holidays;
// a weekend day's window counts from the next working day (A-013).
// ---------------------------------------------------------------------------
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const isWorkingDay = (iso: string, holidays: Set<string>) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return dow !== 0 && dow !== 6 && !holidays.has(iso)
}

/** The last day on which someone may still log `workDate` themselves. */
export function selfEntryDeadline(workDate: string, holidays: Set<string>, selfDays = 3): string {
  let d = workDate
  while (!isWorkingDay(d, holidays)) d = addDays(d, 1)
  let counted = 0
  while (counted < selfDays) {
    d = addDays(d, 1)
    if (isWorkingDay(d, holidays)) counted++
  }
  return d
}
