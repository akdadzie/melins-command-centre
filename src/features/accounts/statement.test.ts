import { describe, expect, it } from 'vitest'
import { parseStatementCsv, suggestMatches } from './statement'

describe('parseStatementCsv', () => {
  it('finds the heading row below account details and reads debit / credit columns', () => {
    const csv = [
      'MeLiNS Associates Limited,,,,',
      'Account,****1234,,,',
      'Period,01/10/2026 - 31/10/2026,,,',
      'Txn Date,Narration,Ref No,Debit,Credit,Balance',
      ',Opening balance,,,,"83,115.12"',
      '02/10/2026,TRF FROM ACME LTD INV-2026-014,FT123,,"10,000.00","93,115.12"',
      '03-Oct-2026,CHEQUE 000123 COURIER,000123,250.00,,"92,865.12"',
      '31/10/2026,Closing balance,,,,"92,865.12"',
    ].join('\n')
    const r = parseStatementCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.columns).toMatchObject({ date: 'Txn Date', description: 'Narration', reference: 'Ref No', debit: 'Debit', credit: 'Credit', balance: 'Balance' })
    expect(r.lines).toEqual([
      { line_date: '2026-10-02', description: 'TRF FROM ACME LTD INV-2026-014', reference: 'FT123', amount: 10000, running_balance: 93115.12 },
      { line_date: '2026-10-03', description: 'CHEQUE 000123 COURIER', reference: '000123', amount: -250, running_balance: 92865.12 },
    ])
  })

  it('reads a signed amount column and CR / DR suffixes', () => {
    const r = parseStatementCsv('Date,Description,Amount\n2026-10-05,MoMo in,"1,200.00 CR"\n2026-10-06,E-levy,(1.50)\n2026-10-07,Fee,5.00 DR')
    expect(r.errors).toEqual([])
    expect(r.lines.map((l) => l.amount)).toEqual([1200, -1.5, -5])
  })

  it('refuses US-order dates rather than guessing, and reports bad lines by number', () => {
    const r = parseStatementCsv('Date,Description,Amount\n10/31/2026,x,5\n01/10/2026,y,abc')
    expect(r.lines).toEqual([])
    expect(r.errors).toEqual(['Line 2: "10/31/2026" isn\'t a date (use DD/MM/YYYY).', 'Line 3: the amount isn\'t a number.'])
  })

  it('needs a date and an amount heading', () => {
    expect(parseStatementCsv('When,What,How much\n01/10/2026,x,5').errors[0]).toMatch(/No heading row/)
  })
})

describe('suggestMatches', () => {
  const entries = [
    { key: 'receipt:a', entry_date: '2026-10-01', amount: 10000 },
    { key: 'receipt:b', entry_date: '2026-10-20', amount: 10000 },
    { key: 'expense:c', entry_date: '2026-10-02', amount: -250 },
    { key: 'receipt:d', entry_date: '2026-10-03', amount: 10000 },
  ]
  it('offers the same amount within a week, nearest first, skipping matched entries', () => {
    expect(suggestMatches({ line_date: '2026-10-02', amount: 10000 }, entries, new Set(['receipt:a'])).map((e) => e.key)).toEqual(['receipt:d'])
    expect(suggestMatches({ line_date: '2026-10-02', amount: 10000 }, entries, new Set()).map((e) => e.key)).toEqual(['receipt:a', 'receipt:d'])
    expect(suggestMatches({ line_date: '2026-10-02', amount: -250 }, entries, new Set()).map((e) => e.key)).toEqual(['expense:c'])
  })
})
