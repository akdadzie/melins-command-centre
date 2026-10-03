// Allocating a payment to invoices (brief §7.4; D-037). Pure; unit-tested.
// A payment has three parts: cash, WHT the client deducted and VAT the client
// withheld. Each must be allocated exactly before the payment is confirmed.

export interface Parts { cash: number; wht: number; vat: number }
export type PartRow = { cash_amount: number | string; wht_amount: number | string; vat_withheld_amount: number | string }

const r2 = (n: number) => Math.round(n * 100) / 100
export const partsOf = (x: PartRow): Parts => ({ cash: Number(x.cash_amount), wht: Number(x.wht_amount), vat: Number(x.vat_withheld_amount) })
export const sumParts = (p: Parts) => r2(p.cash + p.wht + p.vat)

/** What's still to allocate of each part (negative = allocated too much). */
export function leftToAllocate(receipt: PartRow, allocs: PartRow[]): Parts {
  const got = partsOf(receipt)
  const used = allocs.reduce((a, x) => { const p = partsOf(x); return { cash: a.cash + p.cash, wht: a.wht + p.wht, vat: a.vat + p.vat } }, { cash: 0, wht: 0, vat: 0 })
  return { cash: r2(got.cash - used.cash), wht: r2(got.wht - used.wht), vat: r2(got.vat - used.vat) }
}

export const balanced = (left: Parts) => Math.abs(left.cash) < 0.005 && Math.abs(left.wht) < 0.005 && Math.abs(left.vat) < 0.005

/**
 * What to put against one invoice: min(what's left of the payment, what the
 * invoice owes), WHT and VAT withheld first (they belong to the invoice they
 * were deducted from), then cash.
 */
export function autoSplit(left: Parts, owed: number): Parts {
  let room = Math.max(0, owed)
  const take = (avail: number) => { const t = Math.max(0, Math.min(avail, room)); room -= t; return r2(t) }
  const wht = take(left.wht), vat = take(left.vat), cash = take(left.cash)
  return { cash, wht, vat }
}

/** Why the payment can't be confirmed yet, in words; null when it balances. */
export function balanceProblem(left: Parts, money: (n: number) => string): string | null {
  if (balanced(left)) return null
  const parts = ([['cash', left.cash], ['WHT', left.wht], ['VAT withheld', left.vat]] as const).filter(([, v]) => Math.abs(v) >= 0.005)
  return parts.map(([k, v]) => (v > 0 ? `${money(v)} of ${k} not allocated` : `${money(-v)} too much ${k} allocated`)).join('; ')
}
