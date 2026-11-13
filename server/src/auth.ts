import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

export const COOKIE_NAME = 'nc_admin'
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/** Constant-time password comparison (hashing first equalises lengths). */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected))
}

/**
 * Cookie signing key. Bound to the admin password (changing ADMIN_PASSWORD logs everyone out) and to the
 * session epoch from settings.json (bumped on logout → every cookie issued before is invalid).
 */
export const sessionKey = (sessionSecret: string, adminPassword: string, epoch = 0) =>
  createHmac('sha256', sessionSecret).update(`nc-session\0${adminPassword}\0${epoch}`, 'utf8').digest('base64url')

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

export function makeToken(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_TTL_SEC })).toString('base64url')
  return `${payload}.${sign(secret, payload)}`
}

export function verifyToken(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expected = Buffer.from(sign(secret, payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof exp === 'number' && exp * 1000 > now
  } catch {
    return false
  }
}

const isHttps = (c: Context) =>
  c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https' || new URL(c.req.url).protocol === 'https:'

export function setSessionCookie(c: Context, secret: string) {
  setCookie(c, COOKIE_NAME, makeToken(secret), {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SEC,
    secure: isHttps(c),
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'Strict', secure: isHttps(c) })
}

export const isAuthed = (c: Context, secret: string) => verifyToken(secret, getCookie(c, COOKIE_NAME))
