import { describe, expect, it } from 'vitest'
import { signInErrorMessage } from './authErrors'

describe('signInErrorMessage', () => {
  it('says "don\'t match" only for real credential failures', () => {
    expect(signInErrorMessage({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }))
      .toBe('That email and password don\'t match.')
  })
  it('shows a 404 as a setup problem, not a wrong password', () => {
    const m = signInErrorMessage({ status: 404, name: 'AuthUnknownError', message: 'Not Found' })!
    expect(m).toContain('HTTP 404')
    expect(m).toContain('Supabase URL')
    expect(m).not.toMatch(/password/i)
  })
  it('shows a non-JSON reply (AuthUnknownError, no status) as a settings problem', () => {
    const m = signInErrorMessage({ name: 'AuthUnknownError', message: 'Unexpected token < in JSON' })!
    expect(m).toContain('unexpected reply')
    expect(m).not.toMatch(/password|connection/i)
  })
  it('reports a retryable 5xx as a server problem, not a network one', () => {
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', status: 502, message: 'Bad Gateway' })).toContain('HTTP 502')
  })
  it('explains network failures, rate limits, server errors and unknown errors', () => {
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toContain('Couldn\'t reach')
    expect(signInErrorMessage({ status: 429, code: 'over_request_rate_limit', message: 'x' })).toContain('Too many attempts')
    expect(signInErrorMessage({ status: 503, message: 'Service Unavailable' })).toContain('HTTP 503')
    expect(signInErrorMessage({ status: 422, code: 'weak_password', message: 'Password is too weak' }))
      .toBe('Sign-in failed (HTTP 422, weak_password): Password is too weak')
    expect(signInErrorMessage({ status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' })).toContain('invite email')
  })
  it('returns null when there is no error', () => {
    expect(signInErrorMessage(null)).toBeNull()
  })
})
