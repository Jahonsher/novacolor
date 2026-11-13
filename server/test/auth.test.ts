import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { makeToken, passwordMatches, verifyToken } from '../src/auth.js'
import { ConfigError, loadConfig } from '../src/config.js'
import { makeApp, PASSWORD, type TestApp } from './helpers.js'

describe('auth', () => {
  let t: TestApp
  before(async () => {
    t = await makeApp()
  })
  after(() => t.close())

  test('login ok sets a hardened session cookie', async () => {
    const res = await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '1.1.1.1' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    const cookie = res.headers.get('set-cookie') ?? ''
    assert.match(cookie, /^nc_admin=[^;]+/)
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Strict/i)
    assert.match(cookie, /Path=\//)
    assert.match(cookie, /Max-Age=604800/)
    assert.doesNotMatch(cookie, /Secure/) // plain http in tests
  })

  test('Secure cookie behind an HTTPS proxy', async () => {
    const res = await t.request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ password: PASSWORD }),
      ip: '1.1.1.2',
    })
    assert.match(res.headers.get('set-cookie') ?? '', /Secure/)
  })

  test('bad password → 401 with Uzbek error', async () => {
    const res = await t.json('/api/admin/login', 'POST', { password: 'wrong-password' }, { ip: '2.2.2.2' })
    assert.equal(res.status, 401)
    const body = (await res.json()) as { error: string }
    assert.equal(typeof body.error, 'string')
    assert.equal(res.headers.get('set-cookie'), null)
  })

  test('login rate limit: 5 failures per IP → 429, even with the right password', async () => {
    const ip = '3.3.3.3'
    for (let i = 0; i < 5; i++) {
      const r = await t.json('/api/admin/login', 'POST', { password: `bad-${i}-xxxx` }, { ip })
      assert.equal(r.status, 401)
    }
    const blocked = await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip })
    assert.equal(blocked.status, 429)
    // Other IPs are not affected.
    const other = await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '3.3.3.4' })
    assert.equal(other.status, 200)
  })

  test('protected routes → 401 without / with a forged cookie', async () => {
    for (const p of ['/api/admin/me', '/api/admin/leads', '/api/admin/content', '/api/admin/settings']) {
      const res = await t.request(p)
      assert.equal(res.status, 401, p)
      assert.ok(((await res.json()) as { error: string }).error)
    }
    const forged = await t.request('/api/admin/me', { cookie: 'nc_admin=eyJleHAiOjk5OTk5OTk5OTl9.forged' })
    assert.equal(forged.status, 401)
    const post = await t.json('/api/admin/products', 'POST', {})
    assert.equal(post.status, 401)
  })

  test('valid cookie → /me ok; logout clears cookie', async () => {
    const cookie = await t.login()
    const me = await t.request('/api/admin/me', { cookie })
    assert.equal(me.status, 200)
    assert.deepEqual(await me.json(), { ok: true })
    const out = await t.json('/api/admin/logout', 'POST', {}, { cookie })
    assert.equal(out.status, 200)
    assert.match(out.headers.get('set-cookie') ?? '', /nc_admin=;.*Max-Age=0/)
  })

  test('mutations require JSON or multipart content type (CSRF)', async () => {
    const cookie = await t.login()
    const res = await t.request('/api/admin/products', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'slug=x',
      cookie,
    })
    assert.equal(res.status, 415)
  })

  test('token helpers: expiry and tampering', () => {
    const secret = 's3cret'
    const tok = makeToken(secret, Date.now())
    assert.equal(verifyToken(secret, tok), true)
    assert.equal(verifyToken('other', tok), false)
    assert.equal(verifyToken(secret, tok, Date.now() + 8 * 24 * 3600 * 1000), false)
    assert.equal(verifyToken(secret, `${tok}x`), false)
    assert.equal(verifyToken(secret, undefined), false)
    assert.equal(passwordMatches('abc', 'abc'), true)
    assert.equal(passwordMatches('abc', 'abcd'), false)
  })

  test('config refuses to start without a ≥8 char ADMIN_PASSWORD', () => {
    assert.throws(() => loadConfig({}), ConfigError)
    assert.throws(() => loadConfig({ ADMIN_PASSWORD: 'short' }), /kamida 8/)
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678' }).adminPassword, '12345678')
  })

  test('config: telegram token alias and AI provider defaults', () => {
    const c = loadConfig({ ADMIN_PASSWORD: '12345678', telegram_bot_Token: 'abc:def' })
    assert.equal(c.telegram.token, 'abc:def')
    // no key → AI off (the keyless third-party `free` provider is opt-in only)
    assert.equal(c.ai.provider, 'off')
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678', AI_PROVIDER: 'free' }).ai.model, 'openai')
    const a = loadConfig({ ADMIN_PASSWORD: '12345678', ANTHROPIC_API_KEY: 'sk-ant-x' })
    assert.equal(a.ai.provider, 'anthropic')
    assert.equal(a.ai.model, 'claude-opus-5-5')
    const o = loadConfig({ ADMIN_PASSWORD: '12345678', AI_API_KEY: 'k' })
    assert.equal(o.ai.provider, 'openai')
    assert.equal(o.ai.model, 'gpt-4o-mini')
    assert.throws(() => loadConfig({ ADMIN_PASSWORD: '12345678', AI_PROVIDER: 'nope' }), ConfigError)
    // test-only mock provider: allowed in dev/test, refused in production
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678', AI_PROVIDER: 'mock' }).ai.provider, 'mock')
    assert.throws(() => loadConfig({ ADMIN_PASSWORD: '12345678', AI_PROVIDER: 'mock', NODE_ENV: 'production' }), /mock/)
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678' }).telegram.apiBase, 'https://api.telegram.org')
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678', TELEGRAM_API_BASE: 'http://127.0.0.1:9/' }).telegram.apiBase, 'http://127.0.0.1:9')
  })
})
