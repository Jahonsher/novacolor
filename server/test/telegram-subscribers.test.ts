import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describe, test } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.js'
import { redact } from '../src/log.js'
import { SUBSCRIBED_TEXT, UNSUBSCRIBED_TEXT } from '../src/telegram.js'
import { APP_DIR, fakeTelegram, makeApp, PASSWORD, TOKEN, waitFor } from './helpers.js'

const SECRET = 'whsec_0123456789abcdef'
const user = (id: number, first = 'Ali', username?: string) => ({ id, type: 'private', first_name: first, ...(username ? { username } : {}) })
const msg = (update_id: number, chat: object, text: string) => ({ update_id, message: { chat, text } })
const member = (update_id: number, chat: object, status: string) => ({ update_id, my_chat_member: { chat, new_chat_member: { status } } })
const group = (id: number, title = 'Sotuv bo‘limi', type = 'supergroup') => ({ id, type, title })
const lead = { name: 'Ali', phone: '+998901234567' }

describe('telegram subscribers', () => {
  test('polling (no webhook): /start adds + replies once, /stop deactivates, groups via my_chat_member; offset persisted', async () => {
    const tg = fakeTelegram({
      poll: [
        [msg(10, user(111, 'Ali', 'ali_uz'), '/start'), msg(11, user(222, 'Vali'), 'salom'), msg(12, group(-1009), '/start')],
        [member(13, group(-1001234567890), 'member'), member(14, group(-555, 'Eski guruh', 'group'), 'administrator')],
        [msg(15, user(222, 'Vali'), '/start@novacolor_test_bot'), msg(16, user(111), '/stop')],
        [member(17, group(-555, 'Eski guruh', 'group'), 'kicked'), member(18, user(222), 'kicked')],
      ],
    })
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: tg.fetchImpl })
    try {
      t.ctx.telegram.startUpdates()
      await waitFor(() => t.ctx.subscribers.offset === 19)
      assert.equal(t.ctx.telegram.updates.state, 'polling')
      const subs = Object.fromEntries(t.ctx.subscribers.list().map((s) => [s.chatId, s]))
      assert.deepEqual(Object.keys(subs).sort(), ['-1001234567890', '-555', '111', '222'], 'a plain message and /start in a group add nobody')
      assert.equal(subs['111']!.name, 'Ali')
      assert.equal(subs['111']!.username, 'ali_uz')
      assert.equal(subs['111']!.source, 'start')
      assert.equal(subs['111']!.active, false, '/stop')
      assert.equal(subs['111']!.disabledBy, 'user')
      assert.equal(subs['222']!.active, false, 'blocked the bot (my_chat_member kicked)')
      assert.deepEqual(
        { type: subs['-1001234567890']!.type, name: subs['-1001234567890']!.name, active: subs['-1001234567890']!.active },
        { type: 'supergroup', name: 'Sotuv bo‘limi', active: true },
      )
      assert.equal(subs['-555']!.type, 'group')
      assert.equal(subs['-555']!.active, false, 'bot kicked from the group')

      // replies: one per /start, one per /stop, nothing to groups / plain messages
      assert.deepEqual(
        tg.sent().map((m) => [m.chat_id, m.text, m.parse_mode]),
        [
          ['111', SUBSCRIBED_TEXT, undefined],
          ['222', SUBSCRIBED_TEXT, undefined],
          ['111', UNSUBSCRIBED_TEXT, undefined],
        ],
      )
      // offsets: first call without, then last update_id + 1
      const polls = tg.calls.filter((c) => c.url.endsWith('/getUpdates')).map((c) => c.body)
      assert.equal(polls[0].offset, undefined)
      assert.equal(polls[0].timeout, 25)
      assert.deepEqual(polls[0].allowed_updates, ['message', 'my_chat_member'])
      assert.deepEqual(polls.slice(1).map((b) => b.offset), [13, 15, 17, 19])

      const file = path.join(t.dataDir, 'telegram-subscribers.json')
      assert.equal((await stat(file)).mode & 0o777, 0o600)
      const saved = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(saved.updateOffset, 19)
      assert.equal(saved.subscribers.length, 4)
      assert.ok(!tg.methods().some((m) => m === 'deleteWebhook' || m === 'setWebhook'))
    } finally {
      await t.close()
    }
  })

  test('bot has a webhook (another site): no polling, state exposed to admin with host only', async () => {
    const tg = fakeTelegram({ webhookUrl: 'https://novacolor.uz/telegram/hook?token=SECRET123' })
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: tg.fetchImpl })
    try {
      t.ctx.telegram.startUpdates()
      await waitFor(() => t.ctx.telegram.updates.state === 'webhook')
      await new Promise((r) => setTimeout(r, 30))
      assert.deepEqual(tg.methods(), ['getWebhookInfo'], 'getUpdates never called, webhook never touched')
      const cookie = await t.login()
      const s = (await (await t.request('/api/admin/settings', { cookie })).json()) as any
      assert.equal(s.telegram.updates.state, 'webhook')
      assert.equal(s.telegram.updates.webhookHost, 'novacolor.uz')
      assert.ok(!JSON.stringify(s).includes('SECRET123'), 'webhook path/query not exposed')
      // the "recent chats" helper still explains the 409
      const list = (await (await t.request('/api/admin/telegram/chats', { cookie })).json()) as any
      assert.equal(list.ok, false)
      assert.match(list.error, /webhook/)
      assert.ok(!tg.methods().some((m) => m === 'deleteWebhook' || m === 'setWebhook'))
    } finally {
      await t.close()
    }
  })

  test('broadcast: lead goes to all active subscribers; 403/chat-not-found deactivate; one lead = one hourly-cap hit', async () => {
    const tg = fakeTelegram({
      sendErrors: {
        '333': { code: 403, description: 'Forbidden: bot was blocked by the user' },
        '-1004': { code: 400, description: 'Bad Request: chat not found' },
        '555': { code: 400, description: 'Bad Request: message is too long' },
      },
    })
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: tg.fetchImpl })
    try {
      const cookie = await t.login()
      for (const [chatId, name] of [['111', 'Ali'], ['222', 'Vali'], ['333', 'Blokladi'], ['-1004', 'Yo‘q guruh'], ['555', 'Xato'], ['666', 'O‘chiq']]) {
        const r = await t.json('/api/admin/telegram/subscribers', 'POST', { chatId, name }, { cookie })
        assert.equal(r.status, 201)
      }
      await t.json('/api/admin/telegram/subscribers/666', 'PATCH', { active: false }, { cookie })

      const started = Date.now()
      const res = await t.json('/api/leads', 'POST', lead)
      assert.equal(res.status, 201)
      assert.ok(Date.now() - started >= 4 * 40 - 5, 'sends are paced (≤ 25/s)')
      assert.deepEqual(tg.sent().map((m) => m.chat_id).sort(), ['-1004', '111', '222', '333', '555'], 'inactive one skipped')
      assert.ok(tg.sent().every((m) => m.parse_mode === 'HTML' && m.text.includes('Yangi ariza')))
      assert.equal(t.ctx.leads.get()[0]!.telegram, 'sent', 'at least one delivered')
      const by = (id: string) => t.ctx.subscribers.find(id)!
      assert.equal(by('333').active, false)
      assert.equal(by('333').disabledBy, 'telegram')
      assert.equal(by('-1004').active, false)
      assert.equal(by('555').active, true, 'other errors do not deactivate')
      assert.equal((t.ctx.limits.telegram as any).hits.get('global').count, 1, 'hourly cap counts leads, not recipients')

      // test message: counts
      const before = tg.sent().length
      const r = (await (await t.json('/api/admin/telegram/test', 'POST', {}, { cookie })).json()) as any
      assert.deepEqual({ ok: r.ok, total: r.total, sent: r.sent, failed: r.failed }, { ok: true, total: 3, sent: 2, failed: 1 })
      assert.equal(r.results.find((x: any) => !x.ok).chatId, '555')
      assert.equal(tg.sent().length - before, 3)

      // nobody left → failed
      for (const id of ['111', '222', '555']) await t.json(`/api/admin/telegram/subscribers/${id}`, 'PATCH', { active: false }, { cookie })
      await t.json('/api/leads', 'POST', { name: 'B', phone: '+998907777777' })
      assert.equal(t.ctx.leads.list()[0]!.telegram, 'failed')
    } finally {
      await t.close()
    }
  })

  test('webhook receiver: disabled without secret; path + header secret checked; same handling; retries de-duplicated', async () => {
    const off = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: fakeTelegram().fetchImpl })
    try {
      const r = await off.json(`/api/telegram/webhook/${SECRET}`, 'POST', msg(1, user(111), '/start'), {
        headers: { 'x-telegram-bot-api-secret-token': SECRET },
      })
      assert.equal(r.status, 404, 'route disabled without TELEGRAM_WEBHOOK_SECRET')
      assert.equal(off.ctx.subscribers.list().length, 0)
    } finally {
      await off.close()
    }

    const tg = fakeTelegram({ webhookUrl: `https://new.example.uz/api/telegram/webhook/${SECRET}` })
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET }, { telegramFetch: tg.fetchImpl })
    try {
      const post = (p: string, body: unknown, header?: string) =>
        t.json(p, 'POST', body, { headers: header === undefined ? {} : { 'x-telegram-bot-api-secret-token': header } })
      const good = `/api/telegram/webhook/${SECRET}`
      assert.equal((await post('/api/telegram/webhook/wrong-secret-000000', msg(1, user(111), '/start'), SECRET)).status, 404)
      assert.equal((await post(good, msg(1, user(111), '/start'))).status, 401, 'header missing')
      assert.equal((await post(good, msg(1, user(111), '/start'), 'x'.repeat(SECRET.length))).status, 401, 'header wrong')
      assert.equal(t.ctx.subscribers.list().length, 0)
      assert.equal((await post(good, { nope: 1 }, SECRET)).status, 400)

      const ok = await post(good, msg(5, user(111, 'Ali'), '/start'), SECRET)
      assert.equal(ok.status, 200)
      assert.deepEqual(await ok.json(), { ok: true })
      assert.equal(t.ctx.subscribers.find('111')?.active, true)
      assert.deepEqual(tg.sent().map((m) => [m.chat_id, m.text]), [['111', SUBSCRIBED_TEXT]])
      // Telegram retry of the same update: ignored
      assert.equal((await post(good, msg(5, user(111, 'Ali'), '/start'), SECRET)).status, 200)
      assert.equal(tg.sent().length, 1)
      await post(good, member(6, group(-100777), 'member'), SECRET)
      assert.equal(t.ctx.subscribers.find('-100777')?.type, 'supergroup')
      // the secret never reaches the logs
      assert.equal(redact(`POST ${good} 200`), 'POST /api/telegram/webhook/*** 200')

      // the bot's webhook points here → "webhook-self", still no polling
      t.ctx.telegram.startUpdates()
      await waitFor(() => t.ctx.telegram.updates.state === 'webhook-self')
      assert.equal(t.ctx.telegram.updates.webhookHost, 'new.example.uz')
      assert.ok(!tg.methods().includes('getUpdates'))
      const cookie = await t.login()
      const s = (await (await t.request('/api/admin/settings', { cookie })).json()) as any
      assert.equal(s.telegram.webhookReceiver, true)
      assert.ok(!JSON.stringify(s).includes(SECRET))
    } finally {
      await t.close()
    }
  })

  test('mode single still works; mode via PUT /settings/telegram; TELEGRAM_MODE env wins', async () => {
    const tg = fakeTelegram()
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN }, { telegramFetch: tg.fetchImpl })
    try {
      const cookie = await t.login()
      await t.json('/api/admin/telegram/subscribers', 'POST', { chatId: '111', name: 'Ali' }, { cookie })
      assert.equal(t.ctx.telegram.mode, 'subscribers')
      const r = await t.json('/api/admin/settings/telegram', 'PUT', { mode: 'single', chatId: '-1001234567890' }, { cookie })
      assert.equal(r.status, 200)
      const info = (await r.json()) as any
      assert.deepEqual([info.mode, info.modeSource, info.chatId], ['single', 'settings', '-1001234567890'])
      await t.json('/api/leads', 'POST', lead)
      assert.deepEqual(tg.sent().map((m) => m.chat_id), ['-1001234567890'], 'subscribers ignored in single mode')
      assert.equal(t.ctx.leads.get()[0]!.telegram, 'sent')
      const settings = JSON.parse(await readFile(path.join(t.dataDir, 'settings.json'), 'utf8'))
      assert.equal(settings.telegramMode, 'single')

      // switching back: the saved chat ID is kept but unused
      await t.json('/api/admin/settings/telegram', 'PUT', { mode: 'subscribers' }, { cookie })
      await t.json('/api/leads', 'POST', { name: 'B', phone: '+998907777777' })
      assert.deepEqual(tg.sent().map((m) => m.chat_id), ['-1001234567890', '111'])

      for (const bad of [{}, { mode: 'all' }, { mode: 'single', chatId: 'abc' }]) {
        assert.equal((await t.json('/api/admin/settings/telegram', 'PUT', bad, { cookie })).status, 400, JSON.stringify(bad))
      }
    } finally {
      await t.close()
    }

    const e = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_MODE: 'single' }, { telegramFetch: fakeTelegram().fetchImpl })
    try {
      const cookie = await e.login()
      const r = await e.json('/api/admin/settings/telegram', 'PUT', { mode: 'subscribers' }, { cookie })
      assert.equal(r.status, 409)
      assert.match(((await r.json()) as any).error, /TELEGRAM_MODE/)
      assert.equal(e.ctx.telegram.modeSource, 'env')
      // single without a chat ID: a clear reason
      const test1 = (await (await e.json('/api/admin/telegram/test', 'POST', {}, { cookie })).json()) as any
      assert.equal(test1.ok, false)
      assert.match(test1.error, /chat ID kiritilmagan/)
    } finally {
      await e.close()
    }
    const base = { ADMIN_PASSWORD: PASSWORD, APP_DIR }
    assert.throws(() => loadConfig({ ...base, TELEGRAM_MODE: 'everyone' }), ConfigError)
    assert.throws(() => loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: 'short' }), ConfigError)
    assert.throws(() => loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: 'has spaces in it 1234' }), ConfigError)
    assert.equal(loadConfig({ ...base, TELEGRAM_MODE: 'Subscribers' }).telegram.mode, 'subscribers')
  })

  test('admin subscribers API: validation, type inference, sticky admin switch-off, delete, PUT replace, auth/CSRF', async () => {
    const tg = fakeTelegram()
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET }, { telegramFetch: tg.fetchImpl })
    try {
      const cookie = await t.login()
      const add = (b: unknown) => t.json('/api/admin/telegram/subscribers', 'POST', b, { cookie })
      assert.equal((await t.json('/api/admin/telegram/subscribers', 'POST', { chatId: '111', name: 'A' })).status, 401)
      assert.equal(
        (await t.json('/api/admin/telegram/subscribers', 'POST', { chatId: '111', name: 'A' }, { cookie, headers: { origin: 'https://evil.example' } })).status,
        403,
      )
      for (const bad of [{ chatId: 'abc', name: 'A' }, { chatId: '@channel', name: 'A' }, { chatId: '111', name: '' }, { chatId: '111' }]) {
        assert.equal((await add(bad)).status, 400, JSON.stringify(bad))
      }
      const a = (await (await add({ chatId: ' 111 ', name: ' Ali ', username: '@ali_uz' })).json()) as any
      assert.deepEqual([a.chatId, a.name, a.username, a.type, a.source, a.active], ['111', 'Ali', 'ali_uz', 'private', 'manual', true])
      assert.equal(((await (await add({ chatId: '-1001234567890', name: 'Guruh' })).json()) as any).type, 'supergroup')
      assert.equal(((await (await add({ chatId: '-4567', name: 'Kichik guruh' })).json()) as any).type, 'group')
      assert.equal((await add({ chatId: '111', name: 'Again' })).status, 409)

      const list = (await (await t.request('/api/admin/telegram/subscribers', { cookie })).json()) as any
      assert.equal(list.subscribers.length, 3)
      assert.equal(list.max, 100)
      assert.ok('state' in list.updates)

      // switched off by the admin: /start does not turn it back on (and gets no confirmation)
      const p = await t.json('/api/admin/telegram/subscribers/111', 'PATCH', { active: false }, { cookie })
      assert.equal(((await p.json()) as any).disabledBy, 'admin')
      await t.ctx.telegram.handleUpdate(msg(1, user(111), '/start'))
      assert.equal(t.ctx.subscribers.find('111')!.active, false)
      assert.equal(tg.sent().length, 0)
      await t.json('/api/admin/telegram/subscribers/111', 'PATCH', { active: true }, { cookie })
      assert.equal(t.ctx.subscribers.find('111')!.active, true)
      assert.equal(t.ctx.subscribers.find('111')!.disabledBy, undefined)
      assert.equal((await t.json('/api/admin/telegram/subscribers/999', 'PATCH', { active: false }, { cookie })).status, 404)
      assert.equal((await t.json('/api/admin/telegram/subscribers/111', 'PATCH', {}, { cookie })).status, 400)
      assert.equal((await t.json('/api/admin/telegram/subscribers/x1', 'PATCH', { active: true }, { cookie })).status, 400)

      // deleted → a later /start adds it again (as a fresh `start` subscriber)
      assert.equal((await t.request('/api/admin/telegram/subscribers/-4567', { method: 'DELETE', cookie })).status, 200)
      assert.equal((await t.request('/api/admin/telegram/subscribers/-4567', { method: 'DELETE', cookie })).status, 404)
      assert.equal(t.ctx.subscribers.find('-4567'), undefined)

      // PUT replaces the list; known IDs keep addedAt/source
      const addedAt = t.ctx.subscribers.find('111')!.addedAt
      const put = await t.json(
        '/api/admin/telegram/subscribers',
        'PUT',
        { subscribers: [{ chatId: '111', name: 'Ali R.', active: true }, { chatId: '222', name: 'Vali', active: false }] },
        { cookie },
      )
      assert.equal(put.status, 200)
      const after = ((await put.json()) as any).subscribers
      assert.equal(after.length, 2)
      assert.equal(t.ctx.subscribers.find('111')!.addedAt, addedAt)
      assert.equal(t.ctx.subscribers.find('111')!.name, 'Ali R.')
      assert.equal(t.ctx.subscribers.find('222')!.disabledBy, 'admin')
      assert.equal(t.ctx.subscribers.find('-1001234567890'), undefined)
    } finally {
      await t.close()
    }
  })
})
