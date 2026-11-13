import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, test } from 'node:test'
import type { Lead } from '../src/schemas.js'
import { fakeTelegram, makeApp, TOKEN } from './helpers.js'

describe('leads', () => {
  test('valid lead → 201, stored, visible to admin; telegram skipped without token', async () => {
    const t = await makeApp()
    try {
      // The site always sends the honeypot as an empty string.
      const res = await t.json('/api/leads', 'POST', { name: 'Ali', phone: '+998 (90) 123-45-67', product: 'Africa', message: 'Salom', website: '' })
      assert.equal(res.status, 201)
      assert.deepEqual(await res.json(), { ok: true })
      const stored = JSON.parse(await readFile(path.join(t.dataDir, 'leads.json'), 'utf8')) as Lead[]
      assert.equal(stored.length, 1)
      assert.equal(stored[0]!.source, 'contact')
      assert.equal(stored[0]!.status, 'new')
      assert.equal(stored[0]!.telegram, 'skipped')

      const cookie = await t.login()
      const list = (await (await t.request('/api/admin/leads', { cookie })).json()) as Lead[]
      assert.equal(list[0]!.name, 'Ali')

      const patched = await t.json(`/api/admin/leads/${list[0]!.id}`, 'PATCH', { status: 'done', note: 'qo‘ng‘iroq qilindi' }, { cookie })
      assert.equal(patched.status, 200)
      assert.equal(((await patched.json()) as Lead).status, 'done')
      assert.equal((await t.json(`/api/admin/leads/${list[0]!.id}`, 'PATCH', { status: 'weird' }, { cookie })).status, 400)
      assert.equal((await t.request(`/api/admin/leads/${list[0]!.id}`, { method: 'DELETE', cookie })).status, 200)
      assert.equal((await t.request(`/api/admin/leads/${list[0]!.id}`, { method: 'DELETE', cookie })).status, 404)
    } finally {
      await t.close()
    }
  })

  test('validation errors → 400 with { error }', async () => {
    const t = await makeApp()
    try {
      const cases = [
        { name: '', phone: '+998901234567' },
        { name: 'Ali', phone: '123' },
        { name: 'Ali', phone: 'call me maybe' },
        { name: 'Ali', phone: '+998901234567', message: 'x'.repeat(2001) },
        { name: 'x'.repeat(101), phone: '+998901234567' },
        { phone: '+998901234567' },
      ]
      for (const [i, body] of cases.entries()) {
        const res = await t.json('/api/leads', 'POST', body, { ip: `20.0.0.${i}` })
        assert.equal(res.status, 400, JSON.stringify(body))
        assert.equal(typeof ((await res.json()) as { error: string }).error, 'string')
      }
      assert.equal(t.ctx.leads.get().length, 0)
    } finally {
      await t.close()
    }
  })

  test('honeypot: silent 201, nothing stored, no telegram', async () => {
    const tg = fakeTelegram()
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }, { telegramFetch: tg.fetchImpl })
    try {
      const res = await t.json('/api/leads', 'POST', { name: 'Bot', phone: '+1 555 0100', website: 'http://spam' })
      assert.equal(res.status, 201)
      assert.equal(t.ctx.leads.get().length, 0)
      assert.equal(tg.calls.length, 0)
    } finally {
      await t.close()
    }
  })

  test('rate limit: 5 per IP per 10 min → 429', async () => {
    const t = await makeApp()
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await t.json('/api/leads', 'POST', { name: 'A', phone: '901234567' }, { ip: '30.0.0.1' })).status, 201)
      }
      const blocked = await t.json('/api/leads', 'POST', { name: 'A', phone: '901234567' }, { ip: '30.0.0.1' })
      assert.equal(blocked.status, 429)
      assert.ok(((await blocked.json()) as { error: string }).error)
      assert.equal((await t.json('/api/leads', 'POST', { name: 'A', phone: '901234567' }, { ip: '30.0.0.2' })).status, 201)
    } finally {
      await t.close()
    }
  })

  test('telegram sent / failed status is recorded; lead is kept on failure', async () => {
    const ok = fakeTelegram()
    const t1 = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42', PUBLIC_URL: 'https://novacolor.uz/' }, { telegramFetch: ok.fetchImpl })
    try {
      await t1.json('/api/leads', 'POST', { name: '<b>Ali</b> & co', phone: '+998901234567', message: 'Narx?' })
      assert.equal(t1.ctx.leads.get()[0]!.telegram, 'sent')
      const send = ok.calls.find((c) => c.url.endsWith('/sendMessage'))!
      assert.equal(send.body.chat_id, '42')
      assert.equal(send.body.parse_mode, 'HTML')
      assert.match(send.body.text, /Yangi ariza — Sayt formasi/)
      assert.match(send.body.text, /&lt;b&gt;Ali&lt;\/b&gt; &amp; co/)
      assert.match(send.body.text, /https:\/\/novacolor\.uz\/admin\/leads/)
    } finally {
      await t1.close()
    }

    const bad = fakeTelegram({ failSend: true })
    const t2 = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }, { telegramFetch: bad.fetchImpl })
    try {
      const res = await t2.json('/api/leads', 'POST', { name: 'Ali', phone: '+998901234567' })
      assert.equal(res.status, 201)
      assert.equal(t2.ctx.leads.get()[0]!.telegram, 'failed')
    } finally {
      await t2.close()
    }
  })
})
