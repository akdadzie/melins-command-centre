import { describe, expect, it } from 'vitest'
import { defaultCloseMonth, previousMonth } from './golive'

describe('month to close', () => {
  it('is last month', () => {
    expect(previousMonth('2027-01-15')).toBe('2026-12-01')
    expect(defaultCloseMonth('2026-11-03')).toBe('2026-10-01')
  })
  it('is never before go-live (October 2026, D-029)', () => {
    expect(defaultCloseMonth('2026-10-02')).toBe('2026-10-01')
  })
})
