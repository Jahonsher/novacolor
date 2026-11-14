import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fakeTelegram, makeApp, TOKEN } from './helpers.js'

const update = (id: number, chatId: number, type = 'private') => ({ update_id: id, message: { chat: { id: chatId, type } } })

describe('telegram', () => {
  test('sending never reads updates: a chat that only wrote to the bot (not polled, no /start handled) gets nothing', async () => {
    const tg = fakeTelegram({ updates: [update(1, 111), update(2, 222)] })
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: tg.fetchImpl })
    try {
      const res = await t.json('/api/leads', 'POST', { name: 'Ali', phone: '+998901234567' })
      assert.equal(res.status, 201)
      assert.ok(!tg.methods().includes('getUpdates'), 'sending never calls getUpdates')
      assert.ok(!tg.methods().includes('sendMessage'))
      assert.equal(t.ctx.leads.get()[0]!.telegram, 'failed')
      const settings = JSON.parse(await readFile(path.join(t.dataDir, 'settings.json'), 'utf8'))
      assert.equal(settings.telegramChatId, undefined, 'nothing persisted')

      const cookie = await t.login()
      const test1 = await t.json('/api/admin/telegram/test', 'POST', {}, { cookie })
      const body = (await test1.json()) as { ok: boolean; error?: string }
      assert.equal(body.ok, false)
      assert.match(body.error ?? '', /obunachi yo'q.*Chat ID/)
      assert.ok(!JSON.stringify(body).includes(TOKEN))

      const s = (await (await t.request('/api/admin/settings', { cookie })).json()) as any
      assert.deepEqual(s.telegram, {
        configured: true,
        mode: 'subscribers',
        modeSource: 'default',
        chatId: null,
        chatIdSource: null,
        botUsername: 'novacolor_test_bot',
        subscribers: { active: 0, total: 0 },
        updates: { state: 'off', webhookHost: null, checkedAt: null, error: null },
        webhookReceiver: false,
      })
      assert.ok(!JSON.stringify(s).includes(TOKEN))
    } finally {
      await t.close()
    }
  })

  test('admin lists recent chats (explicit pick), sets chat ID in settings.json; env wins', async () => {
    const tg = fakeTelegram({ updates: [update(1, 111), update(2, -100500, 'group'), update(3, 111), update(4, 222)] })
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: tg.fetchImpl })
    try {
      const cookie = await t.login()
      const list = (await (await t.request('/api/admin/telegram/chats', { cookie })).json()) as any
      assert.equal(list.ok, true)
      assert.deepEqual(list.chats.map((c: any) => c.id), ['222', '111', '-100500'], 'latest first, de-duplicated')
      assert.equal(t.ctx.telegram.chatId, null, 'listing saves nothing')

      for (const bad of ['abc', '12', '1; drop', '@ab']) {
        const r = await t.json('/api/admin/settings/telegram', 'PUT', { chatId: bad }, { cookie })
        assert.equal(r.status, 400, bad)
      }
      const r = await t.json('/api/admin/settings/telegram', 'PUT', { chatId: ' 222 ' }, { cookie })
      assert.equal(r.status, 200)
      const info = (await r.json()) as any
      assert.deepEqual(
        { configured: info.configured, chatId: info.chatId, chatIdSource: info.chatIdSource, botUsername: info.botUsername, mode: info.mode },
        { configured: true, chatId: '222', chatIdSource: 'settings', botUsername: 'novacolor_test_bot', mode: 'single' },
        'a saved chat ID (no explicit mode) keeps the old single-chat behaviour',
      )
      const settings = JSON.parse(await readFile(path.join(t.dataDir, 'settings.json'), 'utf8'))
      assert.equal(settings.telegramChatId, '222')

      const ok = await t.json('/api/admin/telegram/test', 'POST', {}, { cookie })
      assert.deepEqual(await ok.json(), { ok: true, total: 1, sent: 1, failed: 0, results: [{ chatId: '222', ok: true }] })
      assert.equal(tg.calls.at(-1)!.body.chat_id, '222')
      await t.json('/api/leads', 'POST', { name: 'Ali', phone: '+998901234567' })
      assert.equal(t.ctx.leads.get()[0]!.telegram, 'sent')

      // clearing
      const cl = await t.json('/api/admin/settings/telegram', 'PUT', { chatId: '' }, { cookie })
      assert.equal(((await cl.json()) as any).chatId, null)
      // not authed / wrong content type
      assert.equal((await t.json('/api/admin/settings/telegram', 'PUT', { chatId: '1234' })).status, 401)
      assert.equal(
        (await t.request('/api/admin/settings/telegram', { method: 'PUT', body: 'chatId=1234', headers: { 'content-type': 'application/x-www-form-urlencoded' }, cookie })).status,
        415,
      )
    } finally {
      await t.close()
    }
    const e = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '777' }, { telegramFetch: fakeTelegram().fetchImpl })
    try {
      const cookie = await e.login()
      const r = await e.json('/api/admin/settings/telegram', 'PUT', { chatId: '1234' }, { cookie })
      assert.equal(r.status, 409)
      assert.match(((await r.json()) as any).error, /TELEGRAM_CHAT_ID/)
      const s = (await (await e.request('/api/admin/settings', { cookie })).json()) as any
      assert.equal(s.telegram.chatIdSource, 'env')
      assert.equal(s.telegram.chatId, '777')
    } finally {
      await e.close()
    }
  })

  test('TELEGRAM_CHAT_ID from env; test message ok', async () => {
    const tg = fakeTelegram()
    const t = await makeApp({ telegram_bot_Token: TOKEN, TELEGRAM_CHAT_ID: '777' }, { telegramFetch: tg.fetchImpl })
    try {
      const cookie = await t.login()
      const res = await t.json('/api/admin/telegram/test', 'POST', {}, { cookie })
      assert.deepEqual(await res.json(), { ok: true, total: 1, sent: 1, failed: 0, results: [{ chatId: '777', ok: true }] })
      assert.deepEqual(tg.methods(), ['sendMessage'])
      assert.equal(t.ctx.telegram.mode, 'single', 'TELEGRAM_CHAT_ID → single by default')
      assert.equal(tg.calls[0]!.body.chat_id, '777')
      assert.ok(tg.calls[0]!.url.includes(TOKEN))
    } finally {
      await t.close()
    }
  })

  test('network errors do not leak the token', async () => {
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '1' }, {
      telegramFetch: async (url) => {
        throw new Error(`connect ECONNREFUSED ${url}`)
      },
    })
    try {
      await assert.rejects(t.ctx.telegram.send('x'), (e: Error) => !e.message.includes(TOKEN) && /tarmoq/.test(e.message))
    } finally {
      await t.close()
    }
  })

  test('active webhook (getUpdates 409) → chat list explains, sending still works with a chat ID', async () => {
    const calls: string[] = []
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, {
      telegramFetch: async (url) => {
        const method = url.split('/').at(-1)!
        calls.push(method)
        if (method === 'getUpdates')
          return new Response(JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: webhook is active' }), { status: 409 })
        return new Response(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'b' } : {} }))
      },
    })
    try {
      const cookie = await t.login()
      const list = (await (await t.request('/api/admin/telegram/chats', { cookie })).json()) as any
      assert.equal(list.ok, false)
      assert.match(list.error, /webhook.*qo'lda/)
      await t.json('/api/admin/settings/telegram', 'PUT', { chatId: '-1001234567890' }, { cookie })
      await t.json('/api/leads', 'POST', { name: 'Ali', phone: '+998901234567' })
      assert.equal(t.ctx.leads.get()[0]!.telegram, 'sent')
      assert.ok(!calls.includes('deleteWebhook') && !calls.includes('setWebhook'))
    } finally {
      await t.close()
    }
  })

  test('health reports telegram configured', async () => {
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN })
    try {
      assert.deepEqual(await (await t.request('/api/health')).json(), { ok: true, ai: false, telegram: true })
    } finally {
      await t.close()
    }
  })
})
