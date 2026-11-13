import type { Lead } from './schemas.js'
import { errMsg, log, registerSecret } from './log.js'
import type { SettingsStore } from './store/stores.js'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 10_000

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

type TgResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number }
type TgChat = { id: number; type?: string; title?: string; username?: string; first_name?: string; last_name?: string }
type TgUpdate = {
  update_id: number
  message?: { chat?: TgChat }
  my_chat_member?: { chat?: TgChat }
}
export type RecentChat = { id: string; type: string; name: string | null; username: string | null }

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

export class Telegram {
  private botUsername: string | null | undefined

  constructor(
    private readonly token: string | undefined,
    private readonly envChatId: string | undefined,
    private readonly settings: SettingsStore,
    private readonly publicUrl: string | undefined,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly apiBase = 'https://api.telegram.org',
    /** Global cap on lead notifications (counts one send; false = over the limit). */
    private readonly allowSend: () => boolean = () => true,
  ) {
    registerSecret(token)
  }

  get configured() {
    return !!this.token
  }

  /** Chat ID in use: TELEGRAM_CHAT_ID (env) first, then the one saved from the admin panel. */
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

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.token) throw new TelegramError('Telegram sozlanmagan (TELEGRAM_BOT_TOKEN yo‘q)')
    let res: Response
    try {
      res = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
      throw new TelegramError(`Telegram ${method}: ${code} ${data.description ?? ''}`.trim(), code)
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
   * Recent chats that wrote to the bot (getUpdates), for the admin to pick from explicitly.
   * Nothing is saved here: auto-saving "whoever wrote first" would let a stranger receive the leads.
   * Fails with 409 while the bot has a webhook (getUpdates is disabled then).
   */
  async recentChats(): Promise<RecentChat[]> {
    let updates: TgUpdate[]
    try {
      updates = await this.call<TgUpdate[]>('getUpdates', { limit: 100, allowed_updates: ['message', 'my_chat_member'] })
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
      const name = c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || null)
      byId.delete(String(c.id)) // keep the latest position
      byId.set(String(c.id), { id: String(c.id), type: c.type ?? 'private', name, username: c.username ?? null })
    }
    return [...byId.values()].reverse().slice(0, 20)
  }

  async send(text: string): Promise<void> {
    const chatId = this.chatId
    if (!chatId) {
      throw new TelegramError(
        "Telegram chat ID kiritilmagan: admin panel → Sozlamalar → Telegram bo'limida Chat ID'ni kiriting (yoki .env'da TELEGRAM_CHAT_ID)",
      )
    }
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    })
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

  /** Send a lead notification; never throws. */
  async notifyLead(lead: Lead): Promise<Lead['telegram']> {
    if (!this.configured) return 'skipped'
    if (!this.allowSend()) {
      log.warn(`Ariza ${lead.id} Telegram'ga yuborilmadi: soatlik xabarlar limiti tugagan (spam?) — ariza admin panelda bor`)
      return 'failed'
    }
    try {
      await this.send(this.formatLead(lead))
      return 'sent'
    } catch (e) {
      log.warn(`Ariza ${lead.id} Telegram'ga yuborilmadi: ${errMsg(e)}`)
      return 'failed'
    }
  }
}
