import { describe, expect, it } from 'vitest'
import { autoSplit, balanced, balanceProblem, leftToAllocate } from './allocation'

const money = (n: number) => `GHS ${n.toFixed(2)}`

describe('allocating a payment (D-037)', () => {
  // The case from the 3 Oct staging test: 24,000 cash + 6,000 WHT against INV-2026-001 (gross 60,000).
  const receipt = { cash_amount: 24000, wht_amount: 6000, vat_withheld_amount: 0 }

  it('splits min(payment, amount owed) into WHT and cash, not the invoice total', () => {
    expect(autoSplit(leftToAllocate(receipt, []), 60000)).toEqual({ cash: 24000, wht: 6000, vat: 0 })
  })

  it('stops at what the invoice owes, WHT first', () => {
    expect(autoSplit({ cash: 24000, wht: 6000, vat: 0 }, 10000)).toEqual({ cash: 4000, wht: 6000, vat: 0 })
  })

  it('reports a stale allocation as over-allocated, part by part', () => {
    const left = leftToAllocate(receipt, [{ cash_amount: 60000, wht_amount: 0, vat_withheld_amount: 0 }])
    expect(left).toEqual({ cash: -36000, wht: 6000, vat: 0 })
    expect(balanced(left)).toBe(false)
    expect(balanceProblem(left, money)).toBe('GHS 36000.00 too much cash allocated; GHS 6000.00 of WHT not allocated')
  })

  it('balances to 0.00 when every part is allocated', () => {
    const left = leftToAllocate(receipt, [{ cash_amount: '20000.00', wht_amount: '5000', vat_withheld_amount: 0 }, { cash_amount: 4000, wht_amount: 1000, vat_withheld_amount: 0 }])
    expect(balanced(left)).toBe(true)
    expect(balanceProblem(left, money)).toBeNull()
  })
})
