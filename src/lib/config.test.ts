import { describe, expect, it } from 'vitest'
import { checkSupabaseUrl, configProblem } from './config'

describe('checkSupabaseUrl', () => {
  it('accepts the project origin, with or without a trailing slash', () => {
    expect(checkSupabaseUrl('https://cipklttzbvbsivzrkcvq.supabase.co')).toEqual({ ok: true, url: 'https://cipklttzbvbsivzrkcvq.supabase.co' })
    expect(checkSupabaseUrl(' https://cipklttzbvbsivzrkcvq.supabase.co/ ')).toEqual({ ok: true, url: 'https://cipklttzbvbsivzrkcvq.supabase.co' })
    expect(checkSupabaseUrl('http://127.0.0.1:54321')).toMatchObject({ ok: true })
  })
  it('rejects a path such as /rest/v1/ and says what to use instead', () => {
    const r = checkSupabaseUrl('https://cipklttzbvbsivzrkcvq.supabase.co/rest/v1/')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('Change "https://cipklttzbvbsivzrkcvq.supabase.co/rest/v1/" to "https://cipklttzbvbsivzrkcvq.supabase.co"')
    expect(checkSupabaseUrl('https://x.supabase.co/auth/v1').ok).toBe(false)
    expect(checkSupabaseUrl('https://x.supabase.co?x=1').ok).toBe(false)
  })
  it('rejects missing, malformed and non-https URLs', () => {
    expect(checkSupabaseUrl(undefined).ok).toBe(false)
    expect(checkSupabaseUrl('cipklttzbvbsivzrkcvq.supabase.co').ok).toBe(false)
    expect(checkSupabaseUrl('http://x.supabase.co').ok).toBe(false)
  })
})

describe('configProblem', () => {
  it('is null when both settings are good, and lists every problem otherwise', () => {
    expect(configProblem('https://x.supabase.co', 'key')).toBeNull()
    const p = configProblem('https://x.supabase.co/rest/v1/', '')
    expect(p).toContain('without a path')
    expect(p).toContain('VITE_SUPABASE_ANON_KEY is not set')
    expect(p).toContain('.env.local')
  })
})
