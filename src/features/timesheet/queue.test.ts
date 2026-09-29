import { describe, expect, it } from 'vitest'
import { isNetworkError, selfEntryDeadline, TimesheetQueue, type EntryPayload, type KeyValueStore, type SendResult } from './queue'

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>()
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) { this.data.set(k, v) }
}

const entry = (ref: string, hours = 8): EntryPayload => ({
  client_ref: ref, staff_id: 's1', work_date: '2026-09-28', category: 'job', job_id: 'j1', hours, description: null, late_reason: null,
})

describe('TimesheetQueue', () => {
  it('keeps entries on the device until the server accepts them', async () => {
    const q = new TimesheetQueue(new MemoryStore(), 'k')
    q.add(entry('a'), 'Beam design')
    q.add(entry('b'), 'Site visit')
    let offline = true
    const send = async (): Promise<SendResult> => (offline ? { ok: false, network: true } : { ok: true })

    expect(await q.flush(send)).toEqual({ sent: 0, rejected: 0, offline: true })
    expect(q.list()).toHaveLength(2)                    // still on the phone

    offline = false
    expect(await q.flush(send)).toEqual({ sent: 2, rejected: 0, offline: false })
    expect(q.list()).toHaveLength(0)
  })

  it('does not duplicate when the same entry is queued twice (same client_ref)', () => {
    const q = new TimesheetQueue(new MemoryStore(), 'k')
    q.add(entry('a', 8), 'x')
    q.add(entry('a', 7.5), 'x')
    expect(q.list().map((e) => e.payload.hours)).toEqual([7.5])
  })

  it('keeps a refused entry with its reason, does not retry it, and carries on with the rest', async () => {
    const q = new TimesheetQueue(new MemoryStore(), 'k')
    q.add(entry('late'), 'x')
    q.add(entry('ok'), 'y')
    const calls: string[] = []
    const send = async (p: EntryPayload): Promise<SendResult> => {
      calls.push(p.client_ref)
      return p.client_ref === 'late' ? { ok: false, network: false, message: 'The entry window has closed' } : { ok: true }
    }
    expect(await q.flush(send)).toEqual({ sent: 1, rejected: 1, offline: false })
    expect(q.list()).toMatchObject([{ state: 'rejected', error: 'The entry window has closed' }])
    await q.flush(send)
    expect(calls).toEqual(['late', 'ok'])                // not retried
    q.retry('late')
    expect(q.list()[0].state).toBe('pending')
  })

  it('survives a corrupted store', () => {
    const s = new MemoryStore(); s.setItem('k', '{not json')
    expect(new TimesheetQueue(s, 'k').list()).toEqual([])
  })
})

describe('isNetworkError', () => {
  it('tells a lost connection from a server refusal', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true)
    expect(isNetworkError({ message: 'The entry window for 22 Sep 2026 has closed', code: '42501' })).toBe(false)
    expect(isNetworkError({ message: 'duplicate key', code: '23505' })).toBe(false)
  })
})

describe('selfEntryDeadline (acceptance 30)', () => {
  const none = new Set<string>()
  it('Monday work can be logged until Thursday', () => {
    expect(selfEntryDeadline('2026-09-21', none)).toBe('2026-09-24')      // Mon -> Thu
  })
  it('a public holiday in between extends it by a day', () => {
    expect(selfEntryDeadline('2026-09-21', new Set(['2026-09-23']))).toBe('2026-09-25')
  })
  it('weekend work counts from the next working day', () => {
    expect(selfEntryDeadline('2026-09-26', none)).toBe('2026-10-01')      // Sat -> Mon + 3 = Thu
  })
  it('Friday work runs over the weekend', () => {
    expect(selfEntryDeadline('2026-09-25', none)).toBe('2026-09-30')      // Fri -> Wed
  })
})
