// Signs in as a test user through the real Auth API, with an authenticator
// code (TOTP) for the roles that need two-factor. Sessions are cached for the
// whole run (the suite runs in one worker, unisolated).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { inject } from 'vitest'
import { apiConfig, assertStaging } from './staging'
import { totp } from './totp'
import type { Fixtures } from '../global-setup'

export type Who = 'owner' | 'director1' | 'director2' | 'accountant' | 'admin' | 'lead' | 'engineer' | 'engineer2' | 'nsp'
const NEEDS_2FA: Who[] = ['owner', 'director1', 'director2', 'accountant']

export const email = (who: Who) => `acc-${who}@melins-acceptance.invalid`
export const fx = (): Fixtures => inject('fixtures')
export const staffId = (name: string) => fx().staff[name]
export const userId = (who: Who) => fx().users[`acc-${who}`]

const secrets = new Map<Who, { factorId: string; secret: string }>()
const cache = new Map<string, Promise<SupabaseClient>>()

function newClient(): SupabaseClient {
  assertStaging()
  const { url, anonKey } = apiConfig()
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

async function passwordOnly(who: Who): Promise<SupabaseClient> {
  const c = newClient()
  const { error } = await c.auth.signInWithPassword({ email: email(who), password: inject('password') })
  if (error) throw new Error(`Sign-in as ${who} failed: ${error.message}`)
  return c
}

// Waits for a fresh 30-second window if this code was just used.
const usedCodes = new Set<string>()
async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const code = totp(secret)
    const key = `${secret}:${code}`
    if (!usedCodes.has(key)) { usedCodes.add(key); return code }
    await new Promise(r => setTimeout(r, 30000 - (Date.now() % 30000) + 200))
  }
}

async function withSecondFactor(who: Who): Promise<SupabaseClient> {
  const c = await passwordOnly(who)
  let f = secrets.get(who)
  if (!f) {
    const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Acceptance suite' })
    if (error) throw new Error(`2FA enrolment for ${who} failed: ${error.message}`)
    f = { factorId: data.id, secret: data.totp.secret }
    secrets.set(who, f)
  }
  const { error } = await c.auth.mfa.challengeAndVerify({ factorId: f.factorId, code: await freshCode(f.secret) })
  if (error) throw new Error(`2FA for ${who} failed: ${error.message}`)
  return c
}

// Not signed in: the public (anon) key only, as the login page has.
export function anon(): SupabaseClient { return newClient() }

// as('owner') = signed in with 2FA where the role needs it; as('owner', 'aal1') = password only.
export function as(who: Who, level: 'aal1' | 'aal2' = 'aal2'): Promise<SupabaseClient> {
  const key = `${who}:${level}`
  if (!cache.has(key)) {
    const p = level === 'aal2' && NEEDS_2FA.includes(who)
      ? withSecondFactor(who)
      : (async () => {
          // aal1 for a 2FA role must come after enrolment, or there's no second factor to skip.
          if (NEEDS_2FA.includes(who)) await as(who, 'aal2')
          return passwordOnly(who)
        })()
    cache.set(key, p)
  }
  return cache.get(key)!
}

// --- small helpers -----------------------------------------------------------

type Result<T> = { data: T | null; error: { message: string } | null }

// The value of a successful call, or a thrown error with the API's message.
export async function ok<T>(p: PromiseLike<Result<T>>, what = 'call'): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${error.message}`)
  return data as T
}

// The API's error message for a call that must be rejected ('' if it succeeded).
export async function rejected(p: PromiseLike<Result<unknown>>): Promise<string> {
  const { error } = await p
  return error?.message ?? ''
}

export async function one<T = Record<string, any>>(p: PromiseLike<Result<T[]>>, what = 'row'): Promise<T> {
  const rows = await ok(p, what)
  if (!rows || rows.length !== 1) throw new Error(`${what}: expected one row, got ${rows?.length ?? 0}`)
  return rows[0]
}
