import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from '../src/ai/anthropic.js'
import { MockProvider as E2eMockProvider } from '../src/ai/mock.js'
import { OpenAiCompatibleProvider } from '../src/ai/openai-compatible.js'
import { buildSystemPrompt } from '../src/ai/prompt.js'
import { AiError, REFUSAL_REPLY } from '../src/ai/types.js'
import { historyWindow } from '../src/routes/chat.js'
import type { ChatSession } from '../src/schemas.js'
import { ChatsStore } from '../src/store/stores.js'
import { fakeTelegram, makeApp, MockProvider, TOKEN } from './helpers.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SID = 'sess-0001-abcdef'
type ChatResponse = { reply?: string; lead?: boolean; error?: string; limit?: boolean }

describe('AI chat route (mocked provider)', () => {
  test('page must be a site path: external-looking values are dropped, message still answered', async () => {
    const t = await makeApp({}, { ai: new MockProvider() })
    try {
      const cases: [string, string | undefined][] = [
        ['///evil.com', undefined],
        ['//evil.com/x', undefined],
        ['https://evil.com', undefined],
        ['/products/x.html', undefined],
        ['/products/teodorico', '/products/teodorico'],
        ['/', '/'],
      ]
      for (const [i, [page, stored]] of cases.entries()) {
        const sid = `page-test-${i}-abcdef`
        const res = await t.json('/api/ai/chat', 'POST', { sessionId: sid, lang: 'uz', page, message: 'salom' })
        assert.equal(res.status, 200, page)
        assert.equal(t.ctx.chats.find(sid)!.page, stored, page)
      }
    } finally {
      await t.close()
    }
  })

  test('AI_PROVIDER=mock (e2e): deterministic reply with a product link, lead noted', async () => {
    const t = await makeApp({ AI_PROVIDER: 'mock' })
    try {
      assert.ok(t.ctx.ai instanceof E2eMockProvider)
      const r1 = (await (await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'salom' })).json()) as ChatResponse
      assert.match(r1.reply ?? '', /\/products\/teodorico/)
      const r2 = (await (await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'ru', message: 'мой номер +998 90 123 45 67' })).json()) as ChatResponse
      assert.equal(r2.lead, true)
      assert.match(r2.reply ?? '', /Рекомендую.*\/products\/teodorico/s)
    } finally {
      await t.close()
    }
  })

  test('reply, stored session, system prompt from catalog in chat language', async () => {
    const ai = new MockProvider()
    const t = await makeApp({}, { ai })
    try {
      const res = await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'ru', page: '/products/africa', message: 'Что посоветуете для гостиной?' })
      assert.equal(res.status, 200)
      const body = (await res.json()) as ChatResponse
      assert.deepEqual(body, { reply: 'Salom! Qanday yordam bera olaman?' })

      const call = ai.calls[0]!
      assert.equal(call.lang, 'ru')
      assert.match(call.system, /Africa — \/products\/africa/)
      assert.match(call.system, /Russian/)
      assert.match(call.system, /Металлик/) // category name in chat language
      assert.match(call.system, /\+998 \(97\) 422 22 77/) // contacts
      assert.match(call.context ?? '', /\/products\/africa/)
      assert.deepEqual(call.messages, [{ role: 'user', content: 'Что посоветуете для гостиной?' }])

      const s = t.ctx.chats.find(SID)!
      assert.equal(s.lang, 'ru')
      assert.equal(s.page, '/products/africa')
      assert.deepEqual(s.messages.map((m) => m.role), ['user', 'assistant'])

      // Second turn includes the history.
      await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'ru', message: 'А для фасада?' })
      assert.equal(ai.calls[1]!.messages.length, 3)

      const cookie = await t.login()
      const list = (await (await t.request('/api/admin/chats', { cookie })).json()) as any[]
      assert.equal(list[0].id, SID)
      assert.equal(list[0].count, 4)
      assert.equal(list[0].preview, 'Что посоветуете для гостиной?')
      assert.equal(list[0].leadId, null)
      const full = (await (await t.request(`/api/admin/chats/${SID}`, { cookie })).json()) as ChatSession
      assert.equal(full.messages.length, 4)
      assert.equal((await t.request('/api/admin/chats/nope-nope-nope', { cookie })).status, 404)
    } finally {
      await t.close()
    }
  })

  test('phone in message → lead (once per session) + telegram, lead: true', async () => {
    const ai = new MockProvider()
    const tg = fakeTelegram()
    const t = await makeApp({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '9' }, { ai, telegramFetch: tg.fetchImpl })
    try {
      await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', page: '/products/africa', message: 'Africa narxi qancha?' })
      const res = await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'Mening ismim Alisher, +998 90 123 45 67' })
      const body = (await res.json()) as ChatResponse
      assert.equal(body.lead, true)
      assert.ok(body.reply)

      const leads = t.ctx.leads.get()
      assert.equal(leads.length, 1)
      const lead = leads[0]!
      assert.equal(lead.source, 'ai')
      assert.equal(lead.phone, '+998 90 123 45 67')
      assert.equal(lead.name, 'Alisher')
      assert.equal(lead.product, 'Africa')
      assert.equal(lead.chatId, SID)
      assert.equal(lead.telegram, 'sent')
      assert.match(lead.message ?? '', /Africa narxi qancha\?/)
      assert.equal(t.ctx.chats.find(SID)!.leadId, lead.id)
      const sent = tg.calls.filter((c) => c.url.endsWith('/sendMessage'))
      assert.equal(sent.length, 1)
      assert.match(sent[0]!.body.text, /AI yordamchi/)
      // The model is told the phone was received.
      assert.match(ai.calls[1]!.context ?? '', /phone number/)

      const again = (await (await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'Yana bir raqam 901112233' })).json()) as ChatResponse
      assert.equal(again.lead, undefined)
      assert.equal(t.ctx.leads.get().length, 1)
      assert.equal(tg.calls.filter((c) => c.url.endsWith('/sendMessage')).length, 1)
    } finally {
      await t.close()
    }
  })

  test('validation, AI off → 503, provider failure → 503, daily limit → 429 { limit: true }', async () => {
    const off = await makeApp()
    try {
      const r = await off.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'salom' })
      assert.equal(r.status, 503)
      assert.ok(((await r.json()) as ChatResponse).error)
    } finally {
      await off.close()
    }

    const failing = new MockProvider(() => {
      throw new AiError('unavailable', 'boom')
    })
    const t = await makeApp({ AI_DAILY_LIMIT: '3' }, { ai: failing })
    try {
      for (const bad of [
        { sessionId: SID, lang: 'en', message: 'hi' },
        { sessionId: 'x', lang: 'uz', message: 'hi' },
        { sessionId: SID, lang: 'uz', message: '' },
        { sessionId: SID, lang: 'uz', message: 'x'.repeat(1001) },
      ]) {
        assert.equal((await t.json('/api/ai/chat', 'POST', bad, { ip: '50.0.0.9' })).status, 400, JSON.stringify(bad).slice(0, 60))
      }

      const r = await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'salom' }, { ip: '50.0.0.1' })
      assert.equal(r.status, 503)
      // Failure with a phone number still captures the lead and answers 200.
      const withPhone = await t.json('/api/ai/chat', 'POST', { sessionId: 'sess-phone-1', lang: 'uz', message: '+998 90 123 45 67' }, { ip: '50.0.0.1' })
      assert.equal(withPhone.status, 200)
      assert.equal(((await withPhone.json()) as ChatResponse).lead, true)
      await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'salom' }, { ip: '50.0.0.1' })
      const limited = await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'salom' }, { ip: '50.0.0.1' })
      assert.equal(limited.status, 429)
      const lb = (await limited.json()) as ChatResponse
      assert.equal(lb.limit, true)
      assert.ok(lb.error)
    } finally {
      await t.close()
    }
  })

  test('retry of a failed message does not store a duplicate user turn', async () => {
    let fail = true
    const ai = new MockProvider(() => {
      if (fail) throw new AiError('timeout', 'slow')
      return { text: 'ok' }
    })
    const t = await makeApp({}, { ai })
    try {
      const msg = { sessionId: SID, lang: 'uz', message: 'Fasad uchun nima bor?' }
      assert.equal((await t.json('/api/ai/chat', 'POST', msg)).status, 503)
      fail = false
      assert.equal((await t.json('/api/ai/chat', 'POST', msg)).status, 200)
      assert.deepEqual(t.ctx.chats.find(SID)!.messages.map((m) => m.role), ['user', 'assistant'])
      assert.deepEqual(ai.calls[1]!.messages, [{ role: 'user', content: 'Fasad uchun nima bor?' }])
      // Same text again after an answer is a new turn.
      await t.json('/api/ai/chat', 'POST', msg)
      assert.equal(t.ctx.chats.find(SID)!.messages.length, 4)
    } finally {
      await t.close()
    }
  })

  test('system prompt is rebuilt when content changes', async () => {
    const ai = new MockProvider()
    const t = await makeApp({}, { ai })
    try {
      await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'salom' })
      assert.doesNotMatch(ai.calls[0]!.system, /Zebra Coat/)
      const cookie = await t.login()
      const p = await t.json(
        '/api/admin/products',
        'POST',
        { slug: 'zebra-coat', name: 'Zebra Coat', categories: [1], image: 'img/x.jpg', subtitle: { uz: 'z', ru: 'з' }, description: { uz: 'zz', ru: 'зз' } },
        { cookie },
      )
      assert.equal(p.status, 201)
      await t.json('/api/ai/chat', 'POST', { sessionId: SID, lang: 'uz', message: 'yana' })
      assert.match(ai.calls[1]!.system, /Zebra Coat — \/products\/zebra-coat/)
    } finally {
      await t.close()
    }
  })

  test('history window: last 20, starts with a user turn', () => {
    const msgs: ChatSession['messages'] = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
      at: '',
    }))
    const w = historyWindow(msgs)
    assert.ok(w.length <= 20)
    assert.equal(w[0]!.role, 'user')
    assert.equal(w.at(-1)!.content, 'm24')
  })

  test('buildSystemPrompt clips descriptions to ~300 chars', async () => {
    const t = await makeApp()
    try {
      const prompt = buildSystemPrompt(t.ctx.content.get(), 'uz')
      const longest = Math.max(...prompt.split('\n').map((l) => l.length))
      assert.ok(longest < 420, `line length ${longest}`)
      assert.match(prompt, /Uzbek/)
    } finally {
      await t.close()
    }
  })

  test('chats.json keeps at most N sessions (oldest dropped)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nc-chats-'))
    try {
      const store = new ChatsStore(dir, 3)
      await store.load()
      for (let i = 0; i < 5; i++) {
        const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
        await store.save({ id: `s${i}`, createdAt: at, updatedAt: at, lang: 'uz', messages: [] })
      }
      assert.deepEqual(store.get().map((s) => s.id), ['s2', 's3', 's4'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Anthropic provider (fake client, no network)', () => {
  const makeFake = (respond: (params: any) => any) => {
    const calls: any[] = []
    const client = {
      beta: {
        messages: {
          create: async (params: any, opts: any) => {
            calls.push({ params, opts })
            return respond(params)
          },
        },
      },
    } as unknown as Anthropic
    return { client, calls }
  }
  const req = { system: 'CATALOG', context: 'page: /', messages: [{ role: 'user' as const, content: 'salom' }], lang: 'uz' as const }

  test('request shape: beta fallbacks, effort low, no thinking, cacheable system first', async () => {
    const { client, calls } = makeFake(() => ({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Salom! ' }, { type: 'text', text: 'Yordam beraman.' }],
    }))
    const p = new AnthropicProvider('sk-ant-test', 'claude-opus-5-5', client)
    const out = await p.chat(req)
    assert.equal(out.text, 'Salom! Yordam beraman.')
    const { params, opts } = calls[0]
    assert.equal(params.model, 'claude-opus-5-5')
    assert.equal(params.max_tokens, 1024)
    assert.deepEqual(params.output_config, { effort: 'low' })
    assert.equal('thinking' in params, false)
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01'])
    assert.equal(params.fallbacks, 'default')
    assert.deepEqual(params.cache_control, { type: 'ephemeral' })
    assert.deepEqual(params.system[0], { type: 'text', text: 'CATALOG', cache_control: { type: 'ephemeral' } })
    assert.deepEqual(params.system[1], { type: 'text', text: 'page: /' })
    assert.deepEqual(params.messages, [{ role: 'user', content: 'salom' }])
    assert.equal(opts.timeout, 25_000)
  })

  test('request shape: claude-haiku-5-5 (no server-side fallback) → no betas / fallbacks, rest unchanged', async () => {
    const { client, calls } = makeFake(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Salom!' }] }))
    const out = await new AnthropicProvider('sk-ant-test', 'claude-haiku-5-5', client).chat(req)
    assert.equal(out.text, 'Salom!')
    const { params } = calls[0]
    assert.equal(params.model, 'claude-haiku-5-5')
    assert.equal('betas' in params, false)
    assert.equal('fallbacks' in params, false)
    assert.equal('thinking' in params, false)
    assert.deepEqual(params.output_config, { effort: 'low' })
    assert.deepEqual(params.cache_control, { type: 'ephemeral' })
    assert.equal(params.max_tokens, 1024)
    // every allow-listed model gets the fallback params
    for (const model of ['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']) {
      await new AnthropicProvider('sk-ant-test', model, client).chat(req)
      assert.equal(calls.at(-1).params.fallbacks, 'default', model)
      assert.deepEqual(calls.at(-1).params.betas, ['server-side-fallback-2026-07-01'], model)
    }
  })

  test('refusal → canned polite reply', async () => {
    const { client } = makeFake(() => ({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] }))
    const out = await new AnthropicProvider('k-123456', 'claude-opus-5-5', client).chat({ ...req, lang: 'ru' })
    assert.equal(out.refused, true)
    assert.equal(out.text, REFUSAL_REPLY.ru)
  })

  test('typed SDK errors map to AiError kinds', async () => {
    const cases: [number, string][] = [
      [401, 'auth'],
      [429, 'rate_limit'],
      [400, 'bad_request'],
      [500, 'unavailable'],
    ]
    for (const [status, kind] of cases) {
      const { client } = makeFake(() => {
        throw Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', new Headers())
      })
      await assert.rejects(new AnthropicProvider('k-123456', 'm', client).chat(req), (e: AiError) => e instanceof AiError && e.kind === kind)
    }
    const { client } = makeFake(() => {
      throw new Anthropic.APIConnectionTimeoutError()
    })
    await assert.rejects(new AnthropicProvider('k-123456', 'm', client).chat(req), (e: AiError) => e.kind === 'timeout')
  })
})

describe('OpenAI-compatible provider (mocked fetch)', () => {
  test('request shape and response parsing', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const p = new OpenAiCompatibleProvider({
      name: 'openai',
      endpoint: 'https://api.example.com/v1/chat/completions',
      model: 'gpt-x',
      apiKey: 'sk-test-123',
      fetchImpl: async (url, init) => {
        seen = { url, init: init! }
        return new Response(JSON.stringify({ choices: [{ message: { content: ' Javob ' } }] }), { status: 200 })
      },
    })
    const out = await p.chat({ system: 'SYS', context: 'CTX', messages: [{ role: 'user', content: 'q' }], lang: 'uz' })
    assert.equal(out.text, 'Javob')
    assert.equal(seen!.url, 'https://api.example.com/v1/chat/completions')
    assert.equal((seen!.init.headers as Record<string, string>).authorization, 'Bearer sk-test-123')
    const body = JSON.parse(String(seen!.init.body))
    assert.equal(body.model, 'gpt-x')
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'SYS\n\nCTX' },
      { role: 'user', content: 'q' },
    ])
  })

  test('HTTP errors map to AiError kinds; no auth header without key', async () => {
    for (const [status, kind] of [
      [401, 'auth'],
      [429, 'rate_limit'],
      [502, 'unavailable'],
    ] as const) {
      let headers: Record<string, string> = {}
      const p = new OpenAiCompatibleProvider({
        name: 'free',
        endpoint: 'https://x/openai',
        model: 'openai',
        fetchImpl: async (_u, init) => {
          headers = init!.headers as Record<string, string>
          return new Response('nope', { status })
        },
      })
      await assert.rejects(p.chat({ system: 's', messages: [{ role: 'user', content: 'q' }], lang: 'uz' }), (e: AiError) => e.kind === kind)
      assert.equal(headers.authorization, undefined)
    }
  })
})
