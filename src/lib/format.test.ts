import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, parseBoolean, parseDate, parseMoney } from './format'

describe('format', () => {
  it('formats money with thousands separators', () => {
    expect(formatMoney(1234567.5)).toBe('GHS 1,234,567.50')
    expect(formatMoney('42000')).toBe('GHS 42,000.00')
    expect(formatMoney(null)).toBe('—')
  })
  it('formats dates as DD MMM YYYY', () => {
    expect(formatDate('2026-09-28')).toBe('28 Sep 2026')
    expect(formatDate('2026-01-05T10:00:00Z')).toBe('5 Jan 2026')
  })
})

describe('parse', () => {
  it('parses money as typed in Ghanaian spreadsheets', () => {
    expect(parseMoney('1,234.50')).toBe(1234.5)
    expect(parseMoney('GHS 62,500')).toBe(62500)
    expect(parseMoney('(250.00)')).toBe(-250)
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('')).toBeNull()
  })
  it('parses day-first dates only', () => {
    expect(parseDate('2026-09-28')).toBe('2026-09-28')
    expect(parseDate('28/09/2026')).toBe('2026-09-28')
    expect(parseDate('03/04/2026')).toBe('2026-04-03')
    expect(parseDate('28 Sep 2026')).toBe('2026-09-28')
    expect(parseDate('28-Sep-26')).toBe('2026-09-28')
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('09/28/2026')).toBeNull()
  })
  it('parses yes/no', () => {
    expect(parseBoolean('Yes')).toBe(true)
    expect(parseBoolean('n')).toBe(false)
    expect(parseBoolean('')).toBeNull()
    expect(parseBoolean('maybe')).toBeNull()
  })
})
