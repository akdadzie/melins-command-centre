// Before the suite: check we're on staging, snapshot it, create the test
// people. After: restore the snapshot. `npm run acceptance:teardown` does the
// restore on its own if a run was interrupted.
import { randomBytes } from 'node:crypto'
import type { TestProject } from 'vitest/node'
import { adminSql, assertStaging, sqlFile } from './lib/staging'

export type Fixtures = {
  staff: Record<string, string>
  directors: Record<string, string>
  users: Record<string, string>
  today: string
  d3: string
  d4: string
  d11: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    password: string
    fixtures: Fixtures
  }
}

export function teardown(): void {
  const [row] = adminSql<{ changes: { tbl: string; deleted: number; restored: number; reinserted: number }[] }>(sqlFile('teardown.sql'))
  const changes = row?.changes ?? []
  const deleted = changes.reduce((n, c) => n + c.deleted, 0)
  const restored = changes.reduce((n, c) => n + c.restored + c.reinserted, 0)
  console.log(`\nStaging restored: ${deleted} test rows removed, ${restored} changed rows put back.`)
}

export default function setup(project: TestProject) {
  assertStaging()
  const [guard] = adminSql<{ has_guard: boolean; leftover: boolean }>(
    `select exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'system_config'
                    and column_name = 'suppress_email_until') as has_guard,
            to_regclass('acceptance.snapshot') is not null as leftover`)
  if (!guard?.has_guard) throw new Error('Migration 2300 (acceptance email guard) is not on staging yet: run npx supabase db push first')
  if (guard.leftover) {
    console.log('A previous run was not tidied up; restoring staging first.')
    teardown()
  }

  const [snap] = adminSql<{ snapshot_rows: number }>(sqlFile('snapshot.sql'))
  console.log(`Staging snapshot taken (${snap.snapshot_rows} rows).`)
  try {
    const password = randomBytes(18).toString('base64url')
    const [{ fixtures }] = adminSql<{ fixtures: Fixtures }>(sqlFile('people.sql').replaceAll('{{PASSWORD}}', password))
    project.provide('password', password)
    project.provide('fixtures', fixtures)
  } catch (e) {
    teardown()
    throw e
  }
  return teardown
}
