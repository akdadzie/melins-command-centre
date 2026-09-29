import { describe, expect, it } from 'vitest'
import { buildLookupIndex, coerce } from '../resources/coerce'
import type { FieldDef, ResourceDef } from '../resources/types'
import { exportCsv, mapHeaders, parseImport, templateCsv } from './csv'

const clientField: FieldDef = {
  name: 'client_id', label: 'Client', type: 'lookup', required: true,
  lookup: { source: 'clients', select: 'id, name', label: (r) => String(r.name) },
}

const resource: ResourceDef = {
  key: 'jobs', table: 'jobs', title: 'Jobs', singular: 'Job',
  orderBy: { column: 'job_number' },
  readRoles: ['owner'], createRoles: ['owner'], editRoles: ['owner'], importRoles: ['owner'],
  importDefaults: { is_imported: true },
  fields: [
    { name: 'job_number', label: 'Job number', type: 'text', required: true },
    { name: 'title', label: 'Title', type: 'text', required: true },
    clientField,
    { name: 'contract_mode', label: 'Contract mode', type: 'select', options: [
      { value: 'consultancy', label: 'Consultancy' }, { value: 'design_build', label: 'Design and build' }] },
    { name: 'fee', label: 'Fee', type: 'money' },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'is_goodwill', label: 'Goodwill', type: 'boolean' },
  ],
}

const clients = buildLookupIndex(
  [{ id: 'c1', name: 'Acme Estates' }, { id: 'c2', name: 'Ministry of Works' }, { id: 'c3', name: 'Dup' }, { id: 'c4', name: 'dup' }],
  clientField,
)

describe('coerce', () => {
  it('resolves lookups by label, case-insensitively, and flags ambiguity', () => {
    expect(coerce(clientField, 'acme estates', clients)).toEqual({ ok: true, value: 'c1' })
    expect(coerce(clientField, 'Nobody', clients)).toMatchObject({ ok: false })
    expect(coerce(clientField, 'DUP', clients)).toMatchObject({ ok: false, error: expect.stringContaining('more than one') })
    expect(coerce(clientField, 'c2', clients)).toEqual({ ok: true, value: 'c2' })
  })
  it('rounds money to 2 dp and enforces required', () => {
    expect(coerce({ name: 'fee', label: 'Fee', type: 'money' }, '1,000.005')).toEqual({ ok: true, value: 1000.01 })
    expect(coerce({ name: 't', label: 'Title', type: 'text', required: true }, '  ')).toMatchObject({ ok: false })
  })
  it('stores fraction percentages as fractions and shows them as percent', async () => {
    const rate: FieldDef = { name: 'rate', label: 'Rate', type: 'percent', fraction: true }
    expect(coerce(rate, '7.5%')).toEqual({ ok: true, value: 0.075 })
    expect(coerce(rate, '2.5')).toEqual({ ok: true, value: 0.025 })
    const { display } = await import('../resources/coerce')
    expect(display(rate, 0.075)).toBe('7.5')
  })
})

describe('csv import', () => {
  it('maps headers by label or column name, ignoring * and case', () => {
    const m = mapHeaders(['Job number *', 'TITLE', 'client_id', 'Colour'], resource.fields)
    expect([...m.columns.values()].map((f) => f.name)).toEqual(['job_number', 'title', 'client_id'])
    expect(m.unknownHeaders).toEqual(['Colour'])
  })

  it('round-trips the template and validates rows with line numbers', () => {
    const tpl = templateCsv(resource)
    const csv = tpl + '\r\nMEL-2025-014,Warehouse,Acme Estates,Design and build,"120,000.00",15/03/2025,yes\r\n' +
      'MEL-2025-015,,Unknown Client,Consultancy,abc,31/02/2025,maybe\r\n'
    const res = parseImport(csv, resource, { client_id: clients })
    expect(res.fileErrors).toEqual([])
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0]).toEqual({
      line: 3, errors: [],
      values: { is_imported: true, job_number: 'MEL-2025-014', title: 'Warehouse', client_id: 'c1',
                contract_mode: 'design_build', fee: 120000, start_date: '2025-03-15', is_goodwill: true },
    })
    expect(res.rows[1].line).toBe(4)
    expect(res.rows[1].errors).toHaveLength(5)
  })

  it('reports a missing required column once for the file', () => {
    const res = parseImport('Title\r\nX\r\n', resource, { client_id: clients })
    expect(res.fileErrors[0]).toMatch(/Job number, Client/)
  })

  it('exports labels, not ids', () => {
    const out = exportCsv(resource, [{ job_number: 'MEL-2026-001', title: 'A', client_id: 'c2', contract_mode: 'consultancy', fee: 5, is_goodwill: false }],
      { client_id: clients })
    expect(out.split('\r\n')[1]).toBe('MEL-2026-001,A,Ministry of Works,Consultancy,5,,No')
  })
})
