import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import sharp from 'sharp'
import { loadConfig } from '../src/config.js'
import { limitKey, normalizeIp, TrustedProxies } from '../src/rate-limit.js'
import type { Lead } from '../src/schemas.js'
import { ChatsStore, LeadsStore } from '../src/store/stores.js'
import { escapeHtml, TELEGRAM_MAX_TEXT, truncateEscaped } from '../src/telegram.js'
import { fakeTelegram, makeApp, MockProvider, PASSWORD, TOKEN } from './helpers.js'

const KB = 1024
const tmp = () => mkdtemp(path.join(tmpdir(), 'nc-hard-'))

/** A body stream of `size` bytes without Content-Length (chunked upload). */
const chunked = (size: number) => {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= size) return ctrl.close()
      const n = Math.min(64 * KB, size - sent)
      sent += n
      ctrl.enqueue(new Uint8Array(n).fill(0x61))
    },
  })
}

describe('H1: body size limits', () => {
  test('public JSON endpoints and login: > 16 KB → 413 (declared or chunked); normal bodies pass', async () => {
    const t = await makeApp({}, { ai: new MockProvider() })
    try {
      const big = 'x'.repeat(17 * KB)
      for (const p of ['/api/ai/chat', '/api/leads', '/api/admin/login']) {
        const r = await t.request(p, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(300 * 1024 * KB) }, body: big, ip: `9.9.${p.length}.1` })
        assert.equal(r.status, 413, p)
        assert.ok(((await r.json()) as { error: string }).error)
        const s = await t.request(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chunked(5 * 1024 * KB), duplex: 'half', ip: `9.8.${p.length}.1` } as RequestInit)
        assert.equal(s.status, 413, `${p} chunked`)
      }
      const ok = await t.json('/api/ai/chat', 'POST', { sessionId: 'size-ok-123', lang: 'uz', message: 'salom' })
      assert.equal(ok.status, 200)
    } finally {
      await t.close()
    }
  })

  test('admin JSON: 1 MB limit after auth; unauthenticated big bodies → 401 without reading', async () => {
    const t = await makeApp()
    try {
      const huge = JSON.stringify({ lead: { uz: 'a'.repeat(1100 * KB), ru: '' }, extra: { uz: '', ru: '' } })
      assert.equal((await t.json('/api/admin/about', 'PUT', JSON.parse(huge))).status, 401)
      const cookie = await t.login()
      const r = await t.request('/api/admin/about', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: huge, cookie })
      assert.equal(r.status, 413)
      const fine = { lead: { uz: 'a'.repeat(9000), ru: 'b' }, extra: { uz: 'c', ru: 'd' } }
      assert.equal((await t.json('/api/admin/about', 'PUT', fine, { cookie })).status, 200)
    } finally {
      await t.close()
    }
  })
})

describe('H2: login rate limit under concurrency', () => {
  test('100 concurrent wrong logins from one IP → at most 5 reach the password check', async () => {
    const t = await makeApp()
    try {
      const res = await Promise.all(
        Array.from({ length: 100 }, (_, i) => t.json('/api/admin/login', 'POST', { password: `wrong-${i}-xxxx` }, { ip: '7.7.7.7' })),
      )
      const counts = res.reduce<Record<number, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})
      assert.equal(counts[401], 5, JSON.stringify(counts))
      assert.equal(counts[429], 95)
      // even the right password is refused now
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '7.7.7.7' })).status, 429)
    } finally {
      await t.close()
    }
  })

  test('success resets the per-IP counter; 50 failures across many IPs → global lockout', async () => {
    const t = await makeApp()
    try {
      for (let i = 0; i < 4; i++) await t.json('/api/admin/login', 'POST', { password: 'bad-password' }, { ip: '6.6.6.6' })
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '6.6.6.6' })).status, 200)
      for (let i = 0; i < 4; i++) assert.equal((await t.json('/api/admin/login', 'POST', { password: 'bad' }, { ip: '6.6.6.6' })).status, 401)

      // 8 failures so far count globally (the successful attempt was taken back); 42 more reach 50
      const res = await Promise.all(
        Array.from({ length: 60 }, (_, i) => t.json('/api/admin/login', 'POST', { password: 'bad-password' }, { ip: `5.5.${i}.1` })),
      )
      assert.equal(res.filter((r) => r.status === 401).length, 42)
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '4.4.4.4' })).status, 429)
    } finally {
      await t.close()
    }
  })

  test('requests already blocked per IP do not eat the global budget', async () => {
    const t = await makeApp()
    try {
      for (let i = 0; i < 200; i++) await t.json('/api/admin/login', 'POST', { password: 'bad-password' }, { ip: '3.2.1.0' })
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '3.2.1.1' })).status, 200)
    } finally {
      await t.close()
    }
  })
})

describe('H3: client IP behind a proxy', () => {
  test('forwarded headers only from a trusted peer; right-most X-Forwarded-For entry wins', async () => {
    const t = await makeApp({}, { ai: new MockProvider() })
    try {
      // direct client (public peer) spoofing X-Forwarded-For: ignored → all attempts count for the peer
      for (let i = 0; i < 5; i++) {
        const r = await t.json('/api/admin/login', 'POST', { password: 'bad-password' }, { peer: '203.0.113.9', headers: { 'x-forwarded-for': `1.1.1.${i}` } })
        assert.equal(r.status, 401)
      }
      const spoofed = await t.request('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': '8.8.8.8' },
        body: JSON.stringify({ password: PASSWORD }),
        peer: '203.0.113.9',
        xff: '9.9.9.9',
      })
      assert.equal(spoofed.status, 429)

      // via the trusted proxy: the client-supplied left part changes, the proxy-appended right-most entry doesn't
      for (let i = 0; i < 5; i++) {
        await t.json('/api/admin/login', 'POST', { password: 'bad-password' }, { ip: `10.${i}.0.1, 198.51.100.7` })
      }
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '6.6.6.6, 198.51.100.7' })).status, 429)
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '198.51.100.8' })).status, 200)
    } finally {
      await t.close()
    }
  })

  test('TRUST_PROXY off: forwarded headers ignored even from loopback', async () => {
    const t = await makeApp({ TRUST_PROXY: '' })
    try {
      for (let i = 0; i < 5; i++) await t.json('/api/admin/login', 'POST', { password: 'bad-password' }, { ip: `2.2.2.${i}` })
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { ip: '2.2.2.200' })).status, 429)
    } finally {
      await t.close()
    }
  })

  test('TRUSTED_PROXIES config, IPv4-mapped IPv6, IPv6 /64 keys, HOST default', () => {
    const def = new TrustedProxies()
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.18.0.3', '10.1.2.3', '192.168.1.1', 'fd00::1']) assert.ok(def.has(ip), ip)
    for (const ip of ['203.0.113.1', '8.8.8.8', '2001:db8::1', '::ffff:8.8.8.8', undefined, 'garbage']) assert.ok(!def.has(ip), String(ip))
    const custom = new TrustedProxies(['203.0.113.0/24', '2001:db8::/32'])
    assert.ok(custom.has('203.0.113.77') && custom.has('2001:db8:1::5') && !custom.has('127.0.0.1'))
    assert.throws(() => loadConfig({ ADMIN_PASSWORD: '12345678', TRUSTED_PROXIES: 'nope' }), /TRUSTED_PROXIES/)
    assert.ok(loadConfig({ ADMIN_PASSWORD: '12345678', TRUSTED_PROXIES: '1.2.3.4, 10.0.0.0/8' }).trustedProxies.has('1.2.3.4'))

    assert.equal(normalizeIp('::FFFF:1.2.3.4'), '1.2.3.4')
    assert.equal(limitKey('1.2.3.4'), '1.2.3.4')
    assert.equal(limitKey('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64')
    assert.equal(limitKey('2001:db8:aa:bb::ffff'), '2001:db8:aa:bb::/64')
    assert.equal(limitKey('2001:0db8:00aa:00bb:9::1'), '2001:db8:aa:bb::/64')
    assert.equal(limitKey('2001:db8::1'), '2001:db8:0:0::/64')

    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678' }).host, '0.0.0.0')
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678', TRUST_PROXY: '1' }).host, '127.0.0.1')
    assert.equal(loadConfig({ ADMIN_PASSWORD: '12345678', TRUST_PROXY: '1', HOST: '0.0.0.0' }).host, '0.0.0.0')
  })
})

describe('M1: AI cost caps', () => {
  test('IPv6 clients are limited per /64', async () => {
    const ai = new MockProvider()
    const t = await makeApp({ AI_DAILY_LIMIT: '3' }, { ai })
    try {
      const statuses = []
      for (let i = 1; i <= 5; i++) {
        const r = await t.json('/api/ai/chat', 'POST', { sessionId: `v6-sess-${i}-abc`, lang: 'uz', message: 'salom' }, { ip: `2001:db8:1:2::${i}` })
        statuses.push(r.status)
      }
      assert.deepEqual(statuses, [200, 200, 200, 429, 429])
      assert.equal((await t.json('/api/ai/chat', 'POST', { sessionId: 'v6-other-abc', lang: 'uz', message: 'salom' }, { ip: '2001:db8:1:3::1' })).status, 200)
    } finally {
      await t.close()
    }
  })

  test('AI_GLOBAL_DAILY_LIMIT: polite reply without calling the AI; phone numbers still become leads', async () => {
    const ai = new MockProvider()
    const t = await makeApp({ AI_GLOBAL_DAILY_LIMIT: '2' }, { ai })
    try {
      for (let i = 0; i < 2; i++) {
        const r = await t.json('/api/ai/chat', 'POST', { sessionId: `glob-${i}-abcdef`, lang: 'uz', message: 'salom' }, { ip: `11.0.0.${i}` })
        assert.equal(r.status, 200)
      }
      assert.equal(ai.calls.length, 2)
      const busy = (await (await t.json('/api/ai/chat', 'POST', { sessionId: 'glob-x-abcdef', lang: 'ru', message: 'привет' }, { ip: '11.0.0.9' })).json()) as { reply: string }
      assert.match(busy.reply, /перегружен/)
      const lead = (await (await t.json('/api/ai/chat', 'POST', { sessionId: 'glob-y-abcdef', lang: 'uz', message: 'raqamim 90 123 45 67' }, { ip: '11.0.0.10' })).json()) as { reply: string; lead?: boolean }
      assert.equal(lead.lead, true)
      assert.match(lead.reply, /Rahmat/)
      assert.equal(ai.calls.length, 2)
      assert.equal(t.ctx.leads.get().length, 1)
    } finally {
      await t.close()
    }
  })

  test('chat session is capped at 100 visitor messages', async () => {
    const ai = new MockProvider()
    const t = await makeApp({ AI_DAILY_LIMIT: '1000' }, { ai })
    try {
      const sid = 'long-session-abc'
      await t.ctx.chats.save({
        id: sid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lang: 'uz',
        messages: Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? ('assistant' as const) : ('user' as const), content: `m${i}`, at: new Date().toISOString() })),
      })
      const r = (await (await t.json('/api/ai/chat', 'POST', { sessionId: sid, lang: 'uz', message: 'yana savol' })).json()) as { reply: string }
      assert.match(r.reply, /qo'ng'iroq qiling yoki telefon raqamingizni qoldiring/)
      assert.equal(ai.calls.length, 0)
    } finally {
      await t.close()
    }
  })

  test('chats.json: concurrent saves are coalesced into few writes and none is lost', async () => {
    const dir = await tmp()
    try {
      const store = new ChatsStore(dir)
      await store.load()
      const now = new Date().toISOString()
      await Promise.all(
        Array.from({ length: 50 }, (_, i) => store.save({ id: `s${i}`, createdAt: now, updatedAt: now, lang: 'uz', messages: [] })),
      )
      const onDisk = JSON.parse(await readFile(path.join(dir, 'chats.json'), 'utf8')) as unknown[]
      assert.equal(onDisk.length, 50)
      assert.equal((await stat(path.join(dir, 'chats.json'))).mode & 0o777, 0o600)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('M2: lead spam', () => {
  test('same phone within 10 min → existing lead updated, no second Telegram message', async () => {
    const tg = fakeTelegram()
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }, { telegramFetch: tg.fetchImpl, ai: new MockProvider() })
    try {
      assert.equal((await t.json('/api/leads', 'POST', { name: 'Ali', phone: '+998 90 123 45 67', message: 'Narx?' })).status, 201)
      assert.equal((await t.json('/api/leads', 'POST', { name: 'Ali', phone: '90 123-45-67', message: 'Yetkazib berish?' }, { ip: '10.0.0.2' })).status, 201)
      // and from the AI chat, same number
      const r = (await (await t.json('/api/ai/chat', 'POST', { sessionId: 'dedupe-chat-1', lang: 'uz', message: 'tel 90 123 45 67' })).json()) as { lead?: boolean }
      assert.equal(r.lead, true)
      const leads = t.ctx.leads.get()
      assert.equal(leads.length, 1)
      assert.match(leads[0]!.message ?? '', /^Narx\?\n\nYetkazib berish\?\n\ntel 90 123 45 67$/)
      assert.equal(leads[0]!.chatId, 'dedupe-chat-1')
      assert.equal(t.ctx.chats.find('dedupe-chat-1')!.leadId, leads[0]!.id)
      assert.equal(tg.methods().filter((m) => m === 'sendMessage').length, 1)
    } finally {
      await t.close()
    }
  })

  test('global hourly cap on new leads → 503 with the phone number; Telegram sends capped too', async () => {
    const tg = fakeTelegram()
    const t = await makeApp({ LEADS_HOURLY_LIMIT: '3', TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }, { telegramFetch: tg.fetchImpl })
    try {
      const st = []
      for (let i = 0; i < 5; i++) st.push((await t.json('/api/leads', 'POST', { name: 'Bot', phone: `+99890000000${i}` }, { ip: `12.0.0.${i}` })).status)
      assert.deepEqual(st, [201, 201, 201, 503, 503])
      assert.equal(t.ctx.leads.get().length, 3)
      for (let i = 0; i < 60; i++) t.ctx.limits.telegram.hit('global')
      const lead = { id: 'x', createdAt: new Date().toISOString(), source: 'contact', name: 'A', phone: '1', status: 'new', telegram: 'skipped' } as Lead
      assert.equal(await t.ctx.telegram.notifyLead(lead), 'failed')
      assert.equal(tg.methods().filter((m) => m === 'sendMessage').length, 3)
    } finally {
      await t.close()
    }
  })

  test('at the cap the oldest DONE leads are evicted; with none done, new leads are refused', async () => {
    const dir = await tmp()
    try {
      const store = new LeadsStore(dir, 3)
      await store.load()
      const ids: string[] = []
      for (let i = 0; i < 3; i++) ids.push((await store.upsert({ source: 'contact', name: `n${i}`, phone: `+1000000${i}` })).lead!.id)
      assert.equal((await store.upsert({ source: 'contact', name: 'spam', phone: '+19999999' })).kind, 'full')
      await store.patch(ids[1]!, { status: 'done' })
      const r = await store.upsert({ source: 'contact', name: 'real', phone: '+18888888' })
      assert.equal(r.kind, 'created')
      assert.deepEqual(store.get().map((l) => l.name), ['n0', 'n2', 'real'])
      assert.equal((await stat(path.join(dir, 'leads.json'))).mode & 0o777, 0o600)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('L1: session revocation', () => {
  test('logout logs out every session; changing ADMIN_PASSWORD invalidates cookies', async () => {
    const t = await makeApp()
    try {
      const a = await t.login('20.0.0.1')
      const b = await t.login('20.0.0.2')
      assert.equal((await t.request('/api/admin/me', { cookie: b })).status, 200)
      assert.equal((await t.json('/api/admin/logout', 'POST', {}, { cookie: a })).status, 200)
      assert.equal((await t.request('/api/admin/me', { cookie: a })).status, 401)
      assert.equal((await t.request('/api/admin/me', { cookie: b })).status, 401)
      assert.equal(t.ctx.settings.get().sessionEpoch, 1)
      const c = await t.login('20.0.0.3')
      assert.equal((await t.request('/api/admin/me', { cookie: c })).status, 200)

      // same data dir (same session secret), different password
      const { createContext } = await import('../src/context.js')
      const { createApp } = await import('../src/app.js')
      const ctx2 = await createContext({ ...t.ctx.config, adminPassword: 'another-password-1' })
      const app2 = createApp(ctx2)
      const env = { incoming: { socket: { remoteAddress: '127.0.0.1' } } }
      assert.equal(ctx2.sessionSecret, t.ctx.sessionSecret)
      assert.equal((await app2.request('/api/admin/me', { headers: { cookie: c } }, env)).status, 401)
      await ctx2.close()
    } finally {
      await t.close()
    }
  })
})

describe('L2: file permissions', () => {
  test('settings / leads / chats are 0600, DATA_DIR is 0700', { skip: process.platform === 'win32' }, async () => {
    const t = await makeApp({}, { ai: new MockProvider() })
    try {
      await t.json('/api/leads', 'POST', { name: 'Ali', phone: '+998901234567' })
      await t.json('/api/ai/chat', 'POST', { sessionId: 'perm-test-abc', lang: 'uz', message: 'salom' })
      await t.ctx.idle()
      for (const f of ['settings.json', 'leads.json', 'chats.json']) {
        assert.equal((await stat(path.join(t.dataDir, f))).mode & 0o777, 0o600, f)
      }
      assert.equal((await stat(t.dataDir)).mode & 0o777, 0o700)
    } finally {
      await t.close()
    }
  })
})

describe('L3/L4: concurrency', () => {
  test('concurrent PDF uploads with the same name get distinct files', async () => {
    const t = await makeApp()
    try {
      const cookie = await t.login()
      const pdf = Buffer.from('%PDF-1.4\n%test\n')
      const res = await Promise.all(
        Array.from({ length: 6 }, () => {
          const fd = new FormData()
          fd.append('file', new Blob([pdf]), 'Sertifikat.pdf')
          fd.append('title_uz', 'S')
          fd.append('title_ru', 'S')
          fd.append('group', 'company')
          return t.request('/api/admin/documents', { method: 'POST', body: fd, cookie })
        }),
      )
      assert.deepEqual(res.map((r) => r.status), Array(6).fill(201))
      const files = t.ctx.content.get().documents.map((d) => d.file).filter((f) => f.startsWith('sertifikat'))
      assert.equal(new Set(files).size, 6)
      for (const f of files) assert.deepEqual(await readFile(path.join(t.dataDir, 'uploads', 'pdf', f)), pdf)
    } finally {
      await t.close()
    }
  })

  test('two concurrent messages on one session: one is refused (409), nothing lost, one lead', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const ai = new MockProvider(async () => {
      await gate
      return { text: 'ok' }
    })
    const t = await makeApp({}, { ai })
    try {
      const sid = 'concurrent-sess-1'
      const p1 = t.json('/api/ai/chat', 'POST', { sessionId: sid, lang: 'uz', message: 'raqamim 90 111 22 33' })
      await new Promise((r) => setTimeout(r, 20))
      const r2 = await t.json('/api/ai/chat', 'POST', { sessionId: sid, lang: 'uz', message: 'ikkinchi 91 444 55 66' })
      assert.equal(r2.status, 409)
      release()
      assert.equal((await p1).status, 200)
      const r3 = await t.json('/api/ai/chat', 'POST', { sessionId: sid, lang: 'uz', message: 'uchinchi' })
      assert.equal(r3.status, 200)
      const s = t.ctx.chats.find(sid)!
      assert.deepEqual(s.messages.filter((m) => m.role === 'user').map((m) => m.content), ['raqamim 90 111 22 33', 'uchinchi'])
      assert.equal(t.ctx.leads.get().length, 1)
    } finally {
      await t.close()
    }
  })
})

describe('L5: Telegram message length', () => {
  test('escape first, truncate without breaking entities or surrogate pairs, total ≤ 4000', async () => {
    const t = await makeApp({ PUBLIC_URL: 'https://novacolor.uz' })
    try {
      const lead = {
        id: 'abc', createdAt: new Date().toISOString(), source: 'contact', status: 'new', telegram: 'skipped',
        name: '&'.repeat(100), phone: '+998901234567', product: '<'.repeat(200), message: '&<>'.repeat(2000),
      } as Lead
      const text = t.ctx.telegram.formatLead(lead)
      assert.ok(text.length <= TELEGRAM_MAX_TEXT, String(text.length))
      // every '&' starts a complete entity
      assert.equal(text.match(/&(?!(amp|lt|gt);)/g), null)
      assert.match(text, /💬 Xabar: (&amp;&lt;&gt;)+/)
      assert.match(text, /admin\/leads\?id=abc$/)

      assert.equal(truncateEscaped(escapeHtml('a&b'), 10), 'a&amp;b')
      assert.equal(truncateEscaped(escapeHtml('ab&cd'), 5), 'ab…')
      assert.equal(truncateEscaped('ab😀cd', 4), 'ab…')
    } finally {
      await t.close()
    }
  })
})

describe('L6: contact and asset validation', () => {
  test('contacts: https t.me / instagram / map hosts, tel: href, email; asset paths only img|uploads|pdf', async () => {
    const t = await makeApp()
    try {
      const cookie = await t.login()
      const base = t.ctx.content.get().contacts
      // current seed content passes as is
      assert.equal((await t.json('/api/admin/contacts', 'PUT', base, { cookie })).status, 200)
      const bad: [string, string][] = [
        ['telegram', 'java\tscript:alert(1)'],
        ['telegram', 'http://t.me/x'],
        ['telegram', 'https://evil.com/t.me'],
        ['instagram', 'https://instagram.com.evil.com/'],
        ['map', 'https://evil.com/map'],
        ['map', 'javascript:alert(1)'],
        ['phoneHref', 'javascript:alert(1)'],
        ['email', 'not-an-email'],
      ]
      for (const [k, v] of bad) assert.equal((await t.json('/api/admin/contacts', 'PUT', { ...base, [k]: v }, { cookie })).status, 400, `${k}=${v}`)
      const good = { ...base, telegram: 'https://telegram.me/x', map: 'https://www.google.com/maps/embed?pb=!1m18', email: '', instagram: '' }
      assert.equal((await t.json('/api/admin/contacts', 'PUT', good, { cookie })).status, 200)

      for (const image of ['java\tscript:alert(1)', 'javascript:alert(1)', 'https://evil.com/a.jpg', 'img/../../etc/passwd', '/img/a.jpg', 'img//a.jpg']) {
        const r = await t.json('/api/admin/categories', 'POST', { name: { uz: 'A', ru: 'A' }, image }, { cookie })
        assert.equal(r.status, 400, image)
      }
      assert.equal((await t.json('/api/admin/categories', 'POST', { name: { uz: 'A', ru: 'A' }, image: 'uploads/images/x-1.webp' }, { cookie })).status, 201)
    } finally {
      await t.close()
    }
  })
})

describe('L8/L9: headers and Origin check', () => {
  test('security headers: no framing of /admin and /api, same-origin framing of the site', async () => {
    const t = await makeApp()
    try {
      for (const p of ['/api/health', '/admin', '/admin/leads']) {
        const r = await t.request(p)
        assert.equal(r.headers.get('x-frame-options'), 'DENY', p)
        assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'none'", p)
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p)
        assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', p)
      }
      for (const p of ['/', '/products/x', '/assets/app-abc123.js']) {
        const r = await t.request(p)
        assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN', p)
        assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'", p)
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p)
      }
    } finally {
      await t.close()
    }
  })

  test('admin mutations with a foreign Origin → 403; own origin / no Origin / trusted X-Forwarded-Host ok', async () => {
    const t = await makeApp()
    try {
      const cookie = await t.login()
      const body = { lead: { uz: 'a', ru: 'b' }, extra: { uz: 'c', ru: 'd' } }
      const put = (headers: Record<string, string>, peer?: string) => t.json('/api/admin/about', 'PUT', body, { cookie, headers, ...(peer ? { peer } : {}) })
      assert.equal((await put({ origin: 'https://evil.example' })).status, 403)
      assert.equal((await put({ origin: 'null' })).status, 403)
      assert.equal((await put({ origin: 'http://localhost' })).status, 200) // app.request host
      assert.equal((await put({})).status, 200)
      assert.equal((await put({ origin: 'https://novacolor.uz', 'x-forwarded-host': 'novacolor.uz' })).status, 200)
      // X-Forwarded-Host from an untrusted peer is ignored
      assert.equal((await put({ origin: 'https://novacolor.uz', 'x-forwarded-host': 'novacolor.uz' }, '203.0.113.5')).status, 403)
      // DELETE too; and the login itself
      assert.equal((await t.request('/api/admin/leads/x', { method: 'DELETE', cookie, headers: { origin: 'https://evil.example' } })).status, 403)
      assert.equal((await t.json('/api/admin/login', 'POST', { password: PASSWORD }, { headers: { origin: 'https://evil.example' } })).status, 403)
    } finally {
      await t.close()
    }
  })
})

describe('L11: sharp memory limits', () => {
  test('one libvips thread; images over ~40 MP are rejected', async () => {
    await import('../src/uploads.js')
    assert.equal(sharp.concurrency(), 1)
    const t = await makeApp()
    try {
      const cookie = await t.login()
      // 7000×7000 = 49 MP, tiny as PNG
      const png = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#fff' } }).png().toBuffer()
      const fd = new FormData()
      fd.append('file', new Blob([png]), 'huge.png')
      const r = await t.request('/api/admin/upload/image', { method: 'POST', body: fd, cookie })
      assert.equal(r.status, 400)
    } finally {
      await t.close()
    }
  })
})
