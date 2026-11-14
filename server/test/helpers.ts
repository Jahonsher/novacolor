import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createContext, type AppContext, type ContextOverrides } from '../src/context.js'
import { setSilent } from '../src/log.js'
import type { FetchLike } from '../src/telegram.js'
import type { AiProvider, ChatRequest, ChatResult } from '../src/ai/types.js'

setSilent(true)

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PASSWORD = 'test-password-123'

export type TestApp = {
  ctx: AppContext
  dataDir: string
  staticDir: string
  /**
   * `ip` → X-Forwarded-For (believed because the default socket peer is 127.0.0.1, a trusted proxy);
   * `peer` → the socket address the request comes from (e.g. a public IP: forwarded headers ignored).
   */
  request: (p: string, init?: RequestInit & { ip?: string; cookie?: string; peer?: string; xff?: string | null }) => Promise<Response>
  login: (ip?: string) => Promise<string>
  json: (p: string, method: string, body: unknown, opts?: { cookie?: string; ip?: string; peer?: string; headers?: Record<string, string> }) => Promise<Response>
  close: () => Promise<void>
}

export async function makeApp(env: Record<string, string> = {}, overrides: ContextOverrides = {}): Promise<TestApp> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nc-test-'))
  const staticDir = path.join(dataDir, '_site')
  await mkdir(path.join(staticDir, 'assets'), { recursive: true })
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>NovaColor</title>')
  await writeFile(path.join(staticDir, 'assets', 'app-abc123.js'), 'console.log(1)')

  const config = loadConfig({
    ADMIN_PASSWORD: PASSWORD,
    APP_DIR,
    DATA_DIR: path.join(dataDir, 'data'),
    STATIC_DIR: staticDir,
    TRUST_PROXY: '1',
    AI_PROVIDER: 'off',
    ...env,
  })
  const ctx = await createContext(config, overrides)
  const app = createApp(ctx)

  const request: TestApp['request'] = (p, init = {}) => {
    const headers = new Headers(init.headers)
    const xff = init.xff === undefined ? (init.ip ?? '10.0.0.1') : init.xff
    if (xff !== null) headers.set('x-forwarded-for', xff)
    if (init.cookie) headers.set('cookie', init.cookie)
    // what @hono/node-server passes as env: getConnInfo() reads the socket peer from it
    const env = { incoming: { socket: { remoteAddress: init.peer ?? '127.0.0.1', remotePort: 40000, remoteFamily: 'IPv4' } } }
    return Promise.resolve(app.request(p, { ...init, headers }, env))
  }
  const json: TestApp['json'] = (p, method, body, opts = {}) =>
    request(p, {
      method,
      body: JSON.stringify(body),
      ...opts,
      headers: { 'content-type': 'application/json', ...opts.headers },
    })
  const login = async (ip = '10.9.9.9') => {
    const res = await json('/api/admin/login', 'POST', { password: PASSWORD }, { ip })
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
    const setCookie = res.headers.get('set-cookie') ?? ''
    return setCookie.split(';')[0]!
  }
  return {
    ctx,
    dataDir: config.dataDir,
    staticDir,
    request,
    json,
    login,
    close: async () => {
      await ctx.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

/** AI provider double that records requests. */
export class MockProvider implements AiProvider {
  readonly name = 'free' as const
  readonly model = 'mock-model'
  calls: ChatRequest[] = []
  constructor(public impl: (req: ChatRequest) => Promise<ChatResult> | ChatResult = () => ({ text: 'Salom! Qanday yordam bera olaman?' })) {}
  async chat(req: ChatRequest) {
    this.calls.push(structuredClone(req))
    return this.impl(req)
  }
}

export type FetchCall = { url: string; body: any }

/**
 * Fake Telegram Bot API. `updates` is what getUpdates returns (static). With `poll`, getUpdates hands out one
 * batch per call (respecting `offset`) and then blocks like a long poll until the request is aborted.
 * `webhookUrl` → getWebhookInfo (and getUpdates answers 409 like the real API). `sendErrors[chatId]` fails that chat.
 */
export function fakeTelegram(
  opts: {
    updates?: unknown[]
    failSend?: boolean
    poll?: { update_id: number }[][]
    webhookUrl?: string
    sendErrors?: Record<string, { code: number; description: string }>
  } = {},
) {
  const calls: FetchCall[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url, body })
    const method = url.split('/').pop()
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    const fail = (code: number, description: string) =>
      new Response(JSON.stringify({ ok: false, error_code: code, description }), { status: code })
    if (method === 'getWebhookInfo') return ok({ url: opts.webhookUrl ?? '', pending_update_count: 0 })
    if (method === 'getUpdates') {
      if (opts.webhookUrl) return fail(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first")
      if (!opts.poll) return ok(opts.updates ?? [])
      const batch = opts.poll.shift()
      if (batch) return ok(batch.filter((u) => u.update_id >= (body.offset ?? 0)))
      // long poll: wait until aborted
      return new Promise<Response>((_, reject) => {
        const sig = init?.signal
        if (sig?.aborted) return reject(new Error('aborted'))
        sig?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }
    if (method === 'getMe') return ok({ username: 'novacolor_test_bot' })
    if (method === 'sendMessage') {
      const err = opts.sendErrors?.[String(body.chat_id)]
      if (err) return fail(err.code, err.description)
      if (opts.failSend) return fail(400, 'Bad Request: chat not found')
      return ok({ message_id: 1 })
    }
    return new Response('{}', { status: 404 })
  }
  return {
    calls,
    fetchImpl,
    methods: () => calls.map((c) => c.url.split('/').pop()),
    sent: () => calls.filter((c) => c.url.endsWith('/sendMessage')).map((c) => c.body as { chat_id: string; text: string; parse_mode?: string }),
  }
}

/** Wait until `cond()` is true (polling loop in tests). */
export async function waitFor(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor: timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

export const TOKEN = '123456:TEST-token-abcdef'
