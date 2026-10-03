// The printed invoice (D-039, D-041): Bill to on the left with the client's
// details, invoice facts on the right, labelled payment options, contacts in
// the header and no repeated tagline.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderRoutes, type Screen } from '../../test/harness'

const h = vi.hoisted(() => ({ db: null as unknown as import('../../test/harness').FakeDb }))
vi.mock('../../lib/supabase', async () => {
  const { createFakeDb, fakeClient } = await import('../../test/harness')
  h.db = createFakeDb()
  const c = fakeClient(h.db)
  return { supabase: c, db: c, appEnv: 'staging', configError: null }
})

import { InvoicePrint } from './InvoicePrint'
import type { Invoice } from './api'

const invoice = {
  id: 'i1', invoice_number: 'INV-2026-001', draft_ref: 'DRAFT-1', status: 'sent', invoice_date: '2026-10-03', due_date: '2026-11-02',
  net_total: 60000, gross_total: 60000, retention_amount: 0, retention_pct: 0, wht_rate: 0.075, gra_einvoice_ref: null,
  job: { id: 'j1', job_number: 'MEL-2026-001', title: 'Office block', retention_pct: 0 },
  client: { id: 'c1', name: 'Acme Ltd', organisation: null, address: '12 Ring Road\nAccra', contact_person: 'Ama Mensah', tin: 'C0012345678',
            vat_number: null, email: 'ap@acme.example', phone: '030 000 0000', deducts_wht: true, wht_category: 'services' },
} as unknown as Invoice

let screen: Screen | null = null
afterEach(() => { screen?.unmount(); screen = null })

describe('printed invoice', () => {
  it('lays out Bill to, invoice facts and payment options as the Owner asked', async () => {
    h.db.tables.company_profile = [{
      registered_name: 'MeLiNS Associates Limited', address: 'Accra', tin: 'C000', vat_number: 'V000', accounts_email: 'accounts@themelins.com',
      company_phone: '+233 20 000 0000', company_email: 'accounts@themelins.com', company_website: 'www.themelins.com',
      payment_bank_name: 'Prudential Bank', payment_bank_branch: 'Taifa Branch', payment_bank_account_number: '0392000680010',
      payment_bank_account_name: 'MeLiNS Associates Limited', payment_momo_network: 'MTN', payment_momo_number: '024 000 0000',
      payment_momo_account_name: 'MeLiNS Associates Limited',
      payment_momo_note: 'Some apps may display the name Kwasi Dadzie Ennison (Managing Director) for this wallet.',
    }]
    screen = await renderRoutes({ '/': <InvoicePrint invoice={invoice} lines={[]} onClose={() => {}} /> }, '/')
    const sheet = screen.container.querySelector('.print-sheet')!
    const text = sheet.textContent!

    const billTo = sheet.querySelector('.bill-to')!.textContent!
    for (const part of ['Acme Ltd', '12 Ring Road', 'Attn: Ama Mensah', 'Tel: 030 000 0000', 'ap@acme.example', 'TIN: C0012345678']) expect(billTo).toContain(part)
    expect(billTo).not.toContain('INV-2026-001')
    expect(sheet.querySelector('.invoice-facts')!.textContent).toContain('INV-2026-001')

    expect(text).toContain('Bank transfer: Prudential Bank, Taifa Branch, A/C 0392000680010, MeLiNS Associates Limited')
    expect(text).toContain('Mobile money (MTN): 024 000 0000, MeLiNS Associates Limited')
    expect(text).toContain('Some apps may display the name Kwasi Dadzie Ennison (Managing Director) for this wallet.')

    const header = sheet.querySelector('.letterhead')!.textContent!
    for (const part of ['Tel: +233 20 000 0000', 'accounts@themelins.com', 'www.themelins.com']) expect(header).toContain(part)
    expect(header).not.toContain('STRUCTURES · CIVILS')
    expect(screen.crashes).toEqual([])
  })
})
