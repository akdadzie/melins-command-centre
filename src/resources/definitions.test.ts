// Guards against drift between the screen definitions and the database:
// every field must be a real column (from the generated types), and every
// dropdown value must appear in a migration (the CHECK constraints).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESOURCES } from './definitions'
import { lookups } from './lookups'

const root = join(__dirname, '..', '..')
const types = readFileSync(join(root, 'src/lib/database.types.ts'), 'utf8').replace(/\r\n/g, '\n')
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n')

/** Column names of a table or view's Row type in the generated types. */
function columnsOf(name: string): Set<string> {
  const start = types.search(new RegExp(`\\n\\s{6}${name}: \\{\\n\\s+Row: \\{`))
  if (start < 0) throw new Error(`${name} not found in database.types.ts`)
  const rowStart = types.indexOf('Row: {', start)
  const rowEnd = types.indexOf('\n        }', rowStart)
  const body = types.slice(rowStart, rowEnd)
  return new Set([...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]))
}

describe('resource definitions match the database', () => {
  for (const r of RESOURCES) {
    it(`${r.key}: fields are columns of ${r.table}`, () => {
      const cols = columnsOf(r.table)
      for (const f of r.fields) expect(cols, `${r.table}.${f.name}`).toContain(f.name)
      for (const c of r.extraListColumns ?? []) expect(cols, `${r.table}.${c.name}`).toContain(c.name)
      for (const k of Object.keys(r.importDefaults ?? {})) expect(cols).toContain(k)
    })
    it(`${r.key}: dropdown values exist in the migrations`, () => {
      for (const f of r.fields.filter((x) => x.type === 'select')) {
        for (const o of f.options!) expect(migrations, `${r.table}.${f.name} = ${o.value}`).toContain(`'${o.value}'`)
      }
    })
  }

  it('lookup sources are readable tables or views', () => {
    for (const [name, lk] of Object.entries(lookups)) {
      const cols = columnsOf(lk.source)
      for (const c of lk.select.split(',').map((x) => x.trim()).filter((x) => !x.includes(':'))) {
        expect(cols, `${name}: ${lk.source}.${c}`).toContain(c)
      }
    }
  })
})
