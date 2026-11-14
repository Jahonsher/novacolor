import { timingSafeEqual } from 'node:crypto'
import type { TelegramMode } from './config.js'
import type { Lead } from './schemas.js'
import { errMsg, log, registerSecret } from './log.js'
import type { SettingsStore } from './store/stores.js'
import type { ChatInfo, SubscribersStore, SubscriberType } from './store/subscribers.js'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 10_000
/** getUpdates long-poll timeout (seconds); the HTTP timeout is a bit longer. */
const POLL_TIMEOUT_S = 25
const WEBHOOK_RECHECK_MS = 10 * 60_000
/** ≤ 25 messages per second in a broadcast (Telegram allows ~30/s per bot). */
const BROADCAST_INTERVAL_MS = 40
const BROADCAST_CONCURRENCY = 5
const ALLOWED_UPDATES = ['message', 'my_chat_member']

export const WEBHOOK_PATH = '/api/telegram/webhook/'

export const SUBSCRIBED_TEXT = "Siz NovaColor arizalari xabarnomasiga obuna bo'ldingiz. Bekor qilish: /stop"
export const UNSUBSCRIBED_TEXT = "Obuna bekor qilindi: endi arizalar sizga yuborilmaydi. Qayta obuna bo'lish: /start"

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Telegram's limit is 4096 characters; stay well below it. */
export const TELEGRAM_MAX_TEXT = 4000

/**
 * Cut already-escaped HTML text to at most `max` UTF-16 units (adding '…') without splitting an entity
 * (`&amp;`) or a surrogate pair (emoji). The text must not contain tags.
 */
export function truncateEscaped(html: string, max: number): string {
  if (html.length <= max) return html
  let cut = html.slice(0, Math.max(0, max - 1))
  cut = cut.replace(/&[a-z#0-9]*$/i, '') // partial entity at the end
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1) // lone high surrogate
  return `${cut}…`
}

/** Constant-time string comparison (webhook secret). */
export function secretEquals(a: string | undefined, b: string): boolean {
  if (a === undefined) return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

type TgResponse<T> = {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}
type TgChat = { id: number; type?: string; title?: string; username?: string; first_name?: string; last_name?: string }
export type TgUpdate = {
  update_id: number
  message?: { chat?: TgChat; text?: string; migrate_to_chat_id?: number }
  my_chat_member?: { chat?: TgChat; new_chat_member?: { status?: string } }
}
export type RecentChat = { id: string; type: string; name: string | null; username: string | null }

/**
 * How the bot's updates (/start …) reach us:
 * `off` — no token / not started; `checking` — first getWebhookInfo pending; `polling` — no webhook, we long-poll;
 * `webhook` — the bot has a webhook to ANOTHER site (e.g. novacolor.uz): we cannot see /start;
 * `webhook-self` — the webhook points to this server; `error` — Telegram unreachable (retrying).
 */
export type UpdatesState = {
  state: 'off' | 'checking' | 'polling' | 'webhook' | 'webhook-self' | 'error'
  /** Host of the webhook URL only (the path may hold a secret). */
  webhookHost: string | null
  checkedAt: string | null
  error: string | null
}

export type SendResult = { chatId: string; name?: string; ok: boolean; error?: string; deactivated?: boolean }
export type BroadcastResult = { total: number; sent: number; failed: number; results: SendResult[] }

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly retryAfter?: number,
    readonly description = '',
  ) {
    super(message)
  }
}

/** The recipient is gone for good: blocked the bot, kicked it, deleted the chat. */
const isGone = (e: unknown) =>
  e instanceof TelegramError && (e.code === 403 || (e.code === 400 && /chat not found|user not found|PEER_ID_INVALID/i.test(e.description)))

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    const t = setTimeout(done, ms)
    t.unref?.()
    function done() {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

/** Run `fn` over `items` with ≤ `concurrency` in flight and starts spaced ≥ `intervalMs` apart. */
async function mapPaced<T, R>(items: T[], concurrency: number, intervalMs: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let nextStart = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      const now = Date.now()
      const slot = Math.max(nextStart, now)
      nextStart = slot + intervalMs
      if (slot > now) await sleep(slot - now)
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return out
}

const chatName = (c: TgChat) => (c.title ?? [c.first_name, c.last_name].filter(Boolean).join(' ')).trim().slice(0, 100)

const chatInfo = (c: TgChat, type: SubscriberType): ChatInfo => ({
  chatId: String(c.id),
  name: chatName(c) || (c.username ? `@${c.username}` : String(c.id)),
  ...(c.username ? { username: c.username.slice(0, 64) } : {}),
  type,
})

/** Command in a private message: `/start`, `/start payload`, `/start@bot`. */
const command = (text: string | undefined) => /^\/(start|stop)(?:@\w+)?(?:\s|$)/i.exec(text ?? '')?.[1]?.toLowerCase()

export type TelegramOptions = {
  token?: string
  envChatId?: string
  envMode?: TelegramMode
  webhookSecret?: string
  settings: SettingsStore
  subscribers: SubscribersStore
  publicUrl?: string
  fetchImpl?: FetchLike
  apiBase?: string
  /** Global cap on lead notifications (counts one lead; false = over the limit). */
  allowSend?: () => boolean
  /** Gap between sendMessage starts in a broadcast (tests may use 0). */
  broadcastIntervalMs?: number
}

export class Telegram {
  private botUsername: string | null | undefined
  private readonly token: string | undefined
  private readonly envChatId: string | undefined
  private readonly envMode: TelegramMode | undefined
  private readonly webhookSecret: string | undefined
  private readonly settings: SettingsStore
  readonly subscribers: SubscribersStore
  private readonly publicUrl: string | undefined
  private readonly fetchImpl: FetchLike
  private readonly apiBase: string
  private readonly allowSend: () => boolean
  private readonly interval: number

  private updatesState: UpdatesState = { state: 'off', webhookHost: null, checkedAt: null, error: null }
  private loggedState = ''
  private loop: { stop: AbortController; done: Promise<void> } | null = null

  constructor(o: TelegramOptions) {
    this.token = o.token
    this.envChatId = o.envChatId
    this.envMode = o.envMode
    this.webhookSecret = o.webhookSecret
    this.settings = o.settings
    this.subscribers = o.subscribers
    this.publicUrl = o.publicUrl
    this.fetchImpl = o.fetchImpl ?? ((u, i) => fetch(u, i))
    this.apiBase = o.apiBase ?? 'https://api.telegram.org'
    this.allowSend = o.allowSend ?? (() => true)
    this.interval = o.broadcastIntervalMs ?? BROADCAST_INTERVAL_MS
    registerSecret(o.token)
    registerSecret(o.webhookSecret)
  }

  get configured() {
    return !!this.token
  }

  /** TELEGRAM_MODE (env) → admin panel → default: `single` if a chat ID is set, else `subscribers`. */
  get mode(): TelegramMode {
    return this.envMode ?? this.settings.get().telegramMode ?? (this.chatId ? 'single' : 'subscribers')
  }

  get modeSource(): 'env' | 'settings' | 'default' {
    return this.envMode ? 'env' : this.settings.get().telegramMode ? 'settings' : 'default'
  }

  async setMode(mode: TelegramMode): Promise<void> {
    await this.settings.patch({ telegramMode: mode })
  }

  /** Chat ID for `single` mode: TELEGRAM_CHAT_ID (env) first, then the one saved from the admin panel. */
  get chatId(): string | null {
    return this.envChatId ?? this.settings.get().telegramChatId ?? null
  }

  /** Where the chat ID comes from: `env` (TELEGRAM_CHAT_ID, wins) or `settings` (set in the admin panel). */
  get chatIdSource(): 'env' | 'settings' | null {
    return this.envChatId ? 'env' : this.settings.get().telegramChatId ? 'settings' : null
  }

  /** Chat ID set from the admin panel (`null` clears it). Ignored while TELEGRAM_CHAT_ID is set. */
  async setChatId(id: string | null): Promise<void> {
    await this.settings.patch({ telegramChatId: id ?? undefined })
  }

  get webhookReceiver(): boolean {
    return !!this.webhookSecret
  }

  get updates(): UpdatesState {
    return { ...this.updatesState }
  }

  private async call<T>(method: string, body?: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    if (!this.token) throw new TelegramError('Telegram sozlanmagan (TELEGRAM_BOT_TOKEN yo‘q)')
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
      })
    } catch (e) {
      throw new TelegramError(`Telegram ${method}: tarmoq xatosi (${errMsg(e)})`)
    }
    let data: TgResponse<T>
    try {
      data = (await res.json()) as TgResponse<T>
    } catch {
      throw new TelegramError(`Telegram ${method}: HTTP ${res.status}, javob JSON emas`)
    }
    if (!res.ok || !data.ok) {
      const code = data.error_code ?? res.status
      const description = data.description ?? ''
      throw new TelegramError(`Telegram ${method}: ${code} ${description}`.trim(), code, data.parameters?.retry_after, description)
    }
    return data.result as T
  }

  async getBotUsername(): Promise<string | null> {
    if (this.botUsername !== undefined || !this.token) return this.botUsername ?? null
    try {
      const me = await this.call<{ username?: string }>('getMe')
      this.botUsername = me.username ?? null
    } catch (e) {
      log.warn(errMsg(e))
      return null
    }
    return this.botUsername
  }

  /**
   * Recent chats that wrote to the bot, for the admin to pick a single chat explicitly.
   * While we receive updates ourselves (polling / own webhook) they are the known subscribers — a parallel
   * getUpdates would steal the poller's updates. Otherwise getUpdates; 409 while the bot has a webhook.
   */
  async recentChats(): Promise<RecentChat[]> {
    if (this.updatesState.state === 'polling' || this.updatesState.state === 'webhook-self') {
      return [...this.subscribers.list()]
        .reverse()
        .slice(0, 20)
        .map((s) => ({ id: s.chatId, type: s.type, name: s.name, username: s.username ?? null }))
    }
    let updates: TgUpdate[]
    try {
      updates = await this.call<TgUpdate[]>('getUpdates', { limit: 100, allowed_updates: ALLOWED_UPDATES })
    } catch (e) {
      if (e instanceof TelegramError && e.code === 409) {
        throw new TelegramError(
          "Botda webhook yoqilgan, shuning uchun yozgan chatlarni ko'rib bo'lmaydi: Chat ID'ni qo'lda kiriting (@userinfobot orqali bilib olsa bo'ladi)",
          409,
        )
      }
      throw e
    }
    const byId = new Map<string, RecentChat>()
    for (const u of updates) {
      const c = u.message?.chat ?? u.my_chat_member?.chat
      if (!c) continue
      byId.delete(String(c.id)) // keep the latest position
      byId.set(String(c.id), { id: String(c.id), type: c.type ?? 'private', name: chatName(c) || null, username: c.username ?? null })
    }
    return [...byId.values()].reverse().slice(0, 20)
  }

  /** Who gets lead notifications right now. */
  recipients(): { chatId: string; name?: string; subscriber: boolean }[] {
    if (this.mode === 'single') return this.chatId ? [{ chatId: this.chatId, subscriber: false }] : []
    return this.subscribers.active().map((s) => ({ chatId: s.chatId, name: s.name, subscriber: true }))
  }

  private noRecipients(): TelegramError {
    return new TelegramError(
      this.mode === 'single'
        ? "Telegram chat ID kiritilmagan: admin panel → Sozlamalar → Telegram bo'limida Chat ID'ni kiriting (yoki .env'da TELEGRAM_CHAT_ID)"
        : "Faol obunachi yo'q: hali hech kim botga /start bosmagan. Admin panel → Sozlamalar → Telegram'da obunachini qo'lda qo'shing (Chat ID) yoki «Bitta chat» rejimini tanlang",
    )
  }

  /** One sendMessage; a 429 is retried once after `retry_after` (≤ 10 s). */
  private async sendTo(chatId: string, text: string, html = true): Promise<void> {
    const body = {
      chat_id: chatId,
      text,
      ...(html ? { parse_mode: 'HTML' } : {}),
      link_preview_options: { is_disabled: true },
    }
    try {
      await this.call('sendMessage', body)
    } catch (e) {
      if (!(e instanceof TelegramError) || e.code !== 429) throw e
      await sleep(Math.min(10, e.retryAfter ?? 1) * 1000)
      await this.call('sendMessage', body)
    }
  }

  /**
   * Send to every recipient (≤ 25 msg/s). Subscribers that blocked the bot / no longer exist are deactivated.
   * Throws only when there is no recipient at all.
   */
  async broadcast(text: string): Promise<BroadcastResult> {
    const recipients = this.recipients()
    if (!recipients.length) throw this.noRecipients()
    const results = await mapPaced(recipients, BROADCAST_CONCURRENCY, this.interval, async (r): Promise<SendResult> => {
      const base = { chatId: r.chatId, ...(r.name ? { name: r.name } : {}) }
      try {
        await this.sendTo(r.chatId, text)
        return { ...base, ok: true }
      } catch (e) {
        const error = errMsg(e)
        let deactivated = false
        if (r.subscriber && isGone(e)) {
          deactivated = await this.subscribers.deactivate(r.chatId, 'telegram').catch(() => false)
          if (deactivated) log.warn(`Telegram obunachi o'chirildi (${r.chatId}): ${error}`)
        }
        return { ...base, ok: false, error, ...(deactivated ? { deactivated } : {}) }
      }
    })
    const sent = results.filter((r) => r.ok).length
    return { total: results.length, sent, failed: results.length - sent, results }
  }

  /** Broadcast; throws if nothing was delivered (first error). */
  async send(text: string): Promise<BroadcastResult> {
    const r = await this.broadcast(text)
    if (!r.sent) throw new TelegramError(r.results[0]?.error ?? 'Yuborilmadi')
    return r
  }

  /** Escape first, then truncate (escaping can make text up to 5× longer); total ≤ TELEGRAM_MAX_TEXT. */
  formatLead(lead: Lead): string {
    const field = (label: string, v: string, max: number) => `${label}${truncateEscaped(escapeHtml(v), max)}`
    const head = [
      `🆕 <b>Yangi ariza — ${lead.source === 'ai' ? 'AI yordamchi' : 'Sayt formasi'}</b>`,
      field('👤 Ism: ', lead.name || '—', 300),
      field('📞 Telefon: ', lead.phone, 100),
    ]
    if (lead.product) head.push(field('🎨 Mahsulot: ', lead.product, 400))
    const tail = this.publicUrl ? [field('🔗 Admin: ', `${this.publicUrl}/admin/leads?id=${lead.id}`, 600)] : []
    const lines = [...head]
    if (lead.message) {
      const used = [...head, ...tail].reduce((n, l) => n + l.length + 1, 0)
      const label = '💬 Xabar: '
      const room = Math.min(1500, TELEGRAM_MAX_TEXT - used - label.length)
      if (room > 20) lines.push(field(label, lead.message, room))
    }
    lines.push(...tail)
    return lines.join('\n')
  }

  /** Send a lead notification to all recipients; `sent` if at least one got it. Never throws. */
  async notifyLead(lead: Lead): Promise<Lead['telegram']> {
    if (!this.configured) return 'skipped'
    if (!this.allowSend()) {
      log.warn(`Ariza ${lead.id} Telegram'ga yuborilmadi: soatlik xabarlar limiti tugagan (spam?) — ariza admin panelda bor`)
      return 'failed'
    }
    try {
      const r = await this.broadcast(this.formatLead(lead))
      if (r.failed) {
        log.warn(`Ariza ${lead.id}: Telegram ${r.sent}/${r.total} ta qabul qiluvchiga yetdi; xato: ${r.results.find((x) => !x.ok)?.error}`)
      }
      return r.sent ? 'sent' : 'failed'
    } catch (e) {
      log.warn(`Ariza ${lead.id} Telegram'ga yuborilmadi: ${errMsg(e)}`)
      return 'failed'
    }
  }

  // ---------------- updates: /start, /stop, bot added to / removed from a group ----------------

  private async reply(chatId: string, text: string) {
    try {
      await this.sendTo(chatId, text, false)
    } catch (e) {
      log.warn(`Telegram javobi yuborilmadi (${chatId}): ${errMsg(e)}`)
    }
  }

  /** Handle one update (from polling or the webhook). */
  async handleUpdate(u: TgUpdate): Promise<void> {
    const msg = u.message
    if (msg?.chat) {
      const chat = msg.chat
      if (msg.migrate_to_chat_id) {
        if (await this.subscribers.migrate(String(chat.id), String(msg.migrate_to_chat_id))) {
          log.info(`Telegram: guruh superguruhga aylandi, obunachi ID yangilandi (${chat.id} → ${msg.migrate_to_chat_id})`)
        }
        return
      }
      if (chat.type !== 'private') return
      const cmd = command(msg.text)
      if (cmd === 'start') {
        const r = await this.subscribers.fromTelegram(chatInfo(chat, 'private'))
        if (r.kind === 'full') {
          log.warn(`Telegram: obunachilar ro'yxati to'la — /start e'tiborsiz qoldirildi (${chat.id})`)
          return
        }
        if (r.kind === 'blocked') return // switched off by the admin: stays off, no confirmation
        if (r.kind !== 'already') log.info(`Telegram: yangi obunachi ${r.subscriber?.name} (${chat.id})`)
        await this.reply(String(chat.id), SUBSCRIBED_TEXT)
      } else if (cmd === 'stop') {
        if (await this.subscribers.deactivate(String(chat.id), 'user')) log.info(`Telegram: obuna bekor qilindi (${chat.id})`)
        await this.reply(String(chat.id), UNSUBSCRIBED_TEXT)
      }
      return
    }
    const m = u.my_chat_member
    if (m?.chat && m.new_chat_member?.status) {
      const chat = m.chat
      const status = m.new_chat_member.status
      const gone = status === 'left' || status === 'kicked'
      if (chat.type === 'group' || chat.type === 'supergroup') {
        if (gone) {
          if (await this.subscribers.deactivate(String(chat.id), 'telegram')) log.info(`Telegram: bot guruhdan chiqarildi (${chat.id})`)
        } else {
          const r = await this.subscribers.fromTelegram(chatInfo(chat, chat.type))
          if (r.kind === 'added' || r.kind === 'reactivated') log.info(`Telegram: bot guruhga qo'shildi — ${r.subscriber?.name} (${chat.id})`)
          if (r.kind === 'full') log.warn(`Telegram: obunachilar ro'yxati to'la — guruh qo'shilmadi (${chat.id})`)
        }
      } else if (chat.type === 'private' && status === 'kicked') {
        if (await this.subscribers.deactivate(String(chat.id), 'user')) log.info(`Telegram: foydalanuvchi botni blokladi (${chat.id})`)
      }
    }
  }

  /** Webhook delivery: skip already-handled update IDs (Telegram retries), handle, remember the offset. */
  async handleWebhookUpdate(u: TgUpdate): Promise<void> {
    if (!Number.isSafeInteger(u.update_id) || u.update_id < this.subscribers.offset) return
    await this.handleUpdate(u)
    await this.subscribers.setOffset(u.update_id + 1)
  }

  private setUpdatesState(state: UpdatesState['state'], webhookHost: string | null = null, error: string | null = null) {
    this.updatesState = { state, webhookHost, checkedAt: new Date().toISOString(), error }
    const key = `${state}|${webhookHost ?? ''}`
    if (key === this.loggedState) return
    this.loggedState = key
    if (state === 'webhook') {
      log.warn(
        `Telegram: bot webhook orqali ${webhookHost} ga ulangan — /start bosganlar bu serverga kelmaydi, obunachilar avtomatik qo'shilmaydi. ` +
          "Ularni admin panel → Sozlamalar → Telegram'da qo'lda qo'shing yoki botni shu serverga ulang (DEPLOY.md).",
      )
    } else if (state === 'polling') log.info("Telegram: botda webhook yo'q — yangilanishlar olinmoqda, /start bosganlar obunachi bo'ladi")
    else if (state === 'webhook-self') log.info('Telegram: bot shu serverga webhook orqali ulangan — obunachilar avtomatik qo‘shiladi')
    else if (state === 'error') log.warn(`Telegram: yangilanishlarni tekshirib bo'lmadi: ${error}`)
  }

  private isOwnWebhook(url: string) {
    return !!this.webhookSecret && url.endsWith(`${WEBHOOK_PATH}${this.webhookSecret}`)
  }

  /**
   * Background loop: getWebhookInfo at start and every 10 min. No webhook → long-poll getUpdates.
   * A webhook (another site's, or ours) → never poll, never touch it (no deleteWebhook/setWebhook).
   */
  startUpdates(): void {
    if (!this.configured || this.loop) return
    const stop = new AbortController()
    this.updatesState = { state: 'checking', webhookHost: null, checkedAt: null, error: null }
    const done = this.runUpdates(stop.signal).catch((e) => log.error(`Telegram yangilanishlari to'xtadi: ${errMsg(e)}`))
    this.loop = { stop, done }
  }

  async stopUpdates(): Promise<void> {
    const l = this.loop
    if (!l) return
    this.loop = null
    l.stop.abort()
    await l.done
  }

  private async runUpdates(signal: AbortSignal): Promise<void> {
    let backoff = 1000
    while (!signal.aborted) {
      let url: string
      try {
        url = (await this.call<{ url?: string }>('getWebhookInfo', {}, { signal })).url ?? ''
      } catch (e) {
        if (signal.aborted) return
        this.setUpdatesState('error', null, errMsg(e))
        await sleep(backoff, signal)
        backoff = Math.min(backoff * 2, 60_000)
        continue
      }
      if (url) {
        let host: string | null = null
        try {
          host = new URL(url).host
        } catch {
          /* keep null */
        }
        this.setUpdatesState(this.isOwnWebhook(url) ? 'webhook-self' : 'webhook', host)
        backoff = 1000
        await sleep(WEBHOOK_RECHECK_MS, signal)
        continue
      }
      this.setUpdatesState('polling')
      const recheckAt = Date.now() + WEBHOOK_RECHECK_MS
      while (!signal.aborted && Date.now() < recheckAt) {
        try {
          const updates = await this.call<TgUpdate[]>(
            'getUpdates',
            { offset: this.subscribers.offset || undefined, timeout: POLL_TIMEOUT_S, allowed_updates: ALLOWED_UPDATES },
            { signal, timeoutMs: (POLL_TIMEOUT_S + 10) * 1000 },
          )
          for (const u of updates) {
            try {
              await this.handleUpdate(u)
            } catch (e) {
              log.warn(`Telegram yangilanishi ${u.update_id}: ${errMsg(e)}`)
            }
          }
          const last = updates.at(-1)?.update_id
          if (last !== undefined) await this.subscribers.setOffset(last + 1)
          backoff = 1000
          if (this.updatesState.state !== 'polling') this.setUpdatesState('polling')
        } catch (e) {
          if (signal.aborted) return
          if (e instanceof TelegramError && e.code === 409) {
            if (/webhook/i.test(e.description)) break // a webhook was set meanwhile → re-check, stop polling
            log.warn(`Telegram: getUpdates'ni boshqa dastur ham chaqirmoqda (${e.description}) — 30 s kutamiz`)
            await sleep(30_000, signal)
            continue
          }
          this.setUpdatesState('error', null, errMsg(e))
          await sleep(backoff, signal)
          backoff = Math.min(backoff * 2, 60_000)
        }
      }
    }
  }
}
