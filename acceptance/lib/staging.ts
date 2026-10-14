// Staging only. Every database call the suite makes goes through here, and
// refuses unless both the linked Supabase project and the API URL are staging.
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const STAGING_REF = 'cipklttzbvbsivzrkcvq'
export const PRODUCTION_REF = 'jqplwpwmpizgkpyrseqo'
export const ROOT = resolve(import.meta.dirname, '..', '..')

function readEnvFile(): Record<string, string> {
  const out: Record<string, string> = {}
  const file = join(ROOT, '.env.local')
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

export function apiConfig(): { url: string; anonKey: string } {
  const env = readEnvFile()
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!url || !anonKey) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (staging) in .env.local')
  return { url, anonKey }
}

export function assertStaging(): void {
  const refFile = join(ROOT, 'supabase', '.temp', 'project-ref')
  const linked = existsSync(refFile) ? readFileSync(refFile, 'utf8').trim() : ''
  const { url } = apiConfig()
  if (linked === PRODUCTION_REF || url.includes(PRODUCTION_REF)) {
    throw new Error('REFUSING TO RUN: this folder or .env.local points at PRODUCTION. The acceptance suite runs on staging only.')
  }
  if (linked !== STAGING_REF) throw new Error(`REFUSING TO RUN: the folder is linked to "${linked}", not staging (${STAGING_REF}). Run: npx supabase link --project-ref ${STAGING_REF}`)
  if (url !== `https://${STAGING_REF}.supabase.co`) throw new Error(`REFUSING TO RUN: VITE_SUPABASE_URL is ${url}, not staging`)
}

// Runs SQL on staging as the database owner (Supabase Management API, via the
// CLI). Returns the rows of the last statement.
export function adminSql<T = Record<string, unknown>>(sql: string): T[] {
  assertStaging()
  const dir = mkdtempSync(join(tmpdir(), 'melins-acc-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql)
  try {
    const out = execSync(`npx supabase db query --linked -f "${file}"`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    })
    const start = out.indexOf('{')
    const end = out.lastIndexOf('}')
    if (start < 0) return []
    return (JSON.parse(out.slice(start, end + 1)).rows ?? []) as T[]
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message: string }
    const detail = (err.stderr || err.stdout || err.message).split('\n').filter(l => !/new version|recommend/i.test(l)).join('\n')
    throw new Error(`SQL on staging failed: ${detail.trim()}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function sqlFile(name: string): string {
  return readFileSync(join(ROOT, 'acceptance', 'sql', name), 'utf8')
}
