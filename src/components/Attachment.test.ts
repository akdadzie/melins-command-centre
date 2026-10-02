import { describe, expect, it } from 'vitest'
import { documentPath, safeFileName } from './Attachment'

describe('document paths', () => {
  it('keeps names readable and safe for storage', () => {
    expect(safeFileName('Receipt from Melcom (2).JPG')).toBe('Receipt-from-Melcom-2.jpg')
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('médical certificate.pdf')).toBe('medical-certificate.pdf')
  })
  it('puts each file under its table and record (A-045)', () => {
    expect(documentPath('expenses', '0b1c', 'scan.pdf', 1700000000000)).toBe('expenses/0b1c/1700000000000-scan.pdf')
  })
})
