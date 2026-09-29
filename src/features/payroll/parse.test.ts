import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { addTotals, colIndex, DEFAULT_STAFF_MAP, matchStaff, parsePayrollCsv } from './parse'

// A synthetic sheet with the May 2026 layout: preamble, headings on row 14,
// staff rows, then "Total". Made-up figures.
function sheet(rows: (string | number)[][]): string {
  const width = 32
  const blank = () => Array(width).fill('')
  const preamble = Array.from({ length: 13 }, (_, i) => { const r = blank(); if (i === 0) r[1] = 'MELINS ASSOCIATES LTD.'; return r })
  const header = blank()
  const heads: Record<string, string> = { A: '# of Staff', B: 'Name', D: 'Basic', E: 'Transport', F: 'Rent Allowance', G: 'Project Bonus',
    H: 'Xmas Bonus', I: 'Gross Pay', J: "SSF Employee's Contribution", K: "PF Employee's Contribution", L: 'Taxable Income', R: 'PAYE',
    T: "Employer's  SSF", U: "Employer's PF", W: 'Security Allowance', X: 'House Help All', AA: 'Utilities', AB: 'Net Pay',
    AC: 'Loan Deductions', AD: 'Bank Amount', AE: 'Total Cost To Company' }
  for (const [c, h] of Object.entries(heads)) header[colIndex(c)] = h
  const body = rows.map((cells) => { const r = blank(); cells.forEach((v, i) => { r[i] = String(v) }); return r })
  return Papa.unparse([...preamble, header, ...body])
}

// One person: basic 1000, transport 100, gross 1100, SSF 55, PAYE 20, security 50, net 1075, loan 75, bank 1000, employer SSF 130.
const person = (name: string) => {
  const r: (string | number)[] = Array(31).fill('')
  const set = (c: string, v: string | number) => { r[colIndex(c)] = v }
  set('A', 1); set('B', name); set('D', '1,000.00'); set('E', 100); set('H', '-'); set('I', '1,100.00'); set('J', 55); set('K', '-')
  set('L', 1045); set('R', 20); set('T', 130); set('U', 0); set('W', 50); set('AB', '1,075.00'); set('AC', 75); set('AD', '1,000.00'); set('AE', 1230)
  return r
}

describe('payroll CSV', () => {
  it('converts column letters', () => {
    expect(colIndex('A')).toBe(0)
    expect(colIndex('Z')).toBe(25)
    expect(colIndex('AA')).toBe(26)
    expect(colIndex('AE')).toBe(30)
  })

  it('reads staff rows under the heading row, sums allowance columns, and stops at Total', () => {
    const total = person(''); total[0] = 'Total'; total[colIndex('AB')] = '2,149.99'
    const res = parsePayrollCsv(sheet([person('Ernest Doe Kwaku Gbadago'), person('Francis Austin'), total]), DEFAULT_STAFF_MAP)
    expect(res.errors).toEqual([])
    expect(res.lines.map((l) => [l.row, l.name])).toEqual([[15, 'Ernest Doe Kwaku Gbadago'], [16, 'Francis Austin']])
    const v = res.lines[0].values
    expect([v.basic, v.taxable_allowances, v.bonus, v.gross, v.ssnit_employee, v.pf_employee, v.paye, v.post_tax_allowances,
      v.net_pay, v.loan_deduction, v.bank_amount, v.ssnit_employer, v.sheet_cost_to_company])
      .toEqual([1000, 100, 0, 1100, 55, 0, 20, 50, 1075, 75, 1000, 130, 1230])
    expect(res.lines[0].taxableDetail).toEqual({ Transport: 100 })
    expect(res.lines[0].postTaxDetail).toEqual({ 'Security Allowance': 50 })
    expect(res.totals?.net_pay).toBe(2149.99)
  })

  it('reports cells that are not numbers, with row and heading', () => {
    const bad = person('Francis Austin'); bad[colIndex('R')] = '#REF!'
    const res = parsePayrollCsv(sheet([bad]), DEFAULT_STAFF_MAP)
    expect(res.errors[0]).toBe('Row 15, column PAYE: "#REF!" is not a number')
    expect(res.errors).toContain('No "Total" row found, so the sheet totals can\'t be checked.')
  })

  it('adds the totals of two sheets (staff + NSP) for one run', () => {
    expect(addTotals({ gross: 10, net_pay: 5 }, { gross: 2.005, paye: 1 })).toEqual({ gross: 12.01, net_pay: 5, paye: 1 })
    expect(addTotals(null, { gross: 1 })).toEqual({ gross: 1 })
  })
})

describe('matchStaff', () => {
  const staff = [
    { id: '1', full_name: 'Ernest Gbadago' }, { id: '2', full_name: 'Nana Poku' }, { id: '3', full_name: 'Francis Austin' },
    { id: '4', full_name: 'NSP1 - Technical' }, { id: '5', full_name: 'Kwasi Dadzie Ennison' },
  ]
  it('matches exact names and fuller sheet names', () => {
    expect(matchStaff('francis austin', staff)?.id).toBe('3')
    expect(matchStaff('Ernest Doe Kwaku Gbadago', staff)?.id).toBe('1')
    expect(matchStaff('Nana Kwaku Adwini Poku', staff)?.id).toBe('2')
    expect(matchStaff('Kwasi Dadzie Ennison', staff)?.id).toBe('5')
  })
  it('leaves unknown or ambiguous names for a person to match', () => {
    expect(matchStaff('Abena Mensah', staff)).toBeNull()
    expect(matchStaff('Nana', staff)).toBeNull()
  })
})
