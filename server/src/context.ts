import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { sessionKey } from './auth.js'
import type { Config } from './config.js'
import { createProvider } from './ai/index.js'
import { PromptCache } from './ai/prompt.js'
import type { AiProvider } from './ai/types.js'
import { registerSecret } from './log.js'
import { RateLimiter } from './rate-limit.js'
import { ContentStore } from './store/content.js'
import { tryChmod } from './store/fs-utils.js'
import { ChatsStore, LeadsStore, SettingsStore } from './store/stores.js'
import { SubscribersStore } from './store/subscribers.js'
import { Telegram, type FetchLike } from './telegram.js'

/** Lead notifications per hour across all visitors (spam must not flood the chat or hit Telegram limits). */
export const TELEGRAM_HOURLY_LIMIT = 60

export type AppContext = {
  config: Config
  content: ContentStore
  leads: LeadsStore
  chats: ChatsStore
  settings: SettingsStore
  /** Telegram lead-notification subscribers (DATA_DIR/telegram-subscribers.json). */
  subscribers: SubscribersStore
  telegram: Telegram
  ai: AiProvider | null
  prompts: PromptCache
  sessionSecret: string
  /** Current cookie signing key (depends on ADMIN_PASSWORD and the session epoch). */
  sessionKey(): string
  uploadsDir: string
  limits: {
    /** per IP: login attempts (counted before the password check, reset on success) */
    login: RateLimiter
    /** all IPs together: failed logins */
    loginGlobal: RateLimiter
    /** per IP: contact form posts */
    leads: RateLimiter
    /** all IPs together: new leads per hour */
    leadsGlobal: RateLimiter
    /** all IPs together: Telegram lead notifications per hour */
    telegram: RateLimiter
    /** per IP: AI messages per day */
    ai: RateLimiter
    /** all IPs together: AI messages per day (cost cap) */
    aiGlobal: RateLimiter
  }
  /** Wait for pending writes (graceful shutdown / tests). */
  idle(): Promise<void>
  close(): Promise<void>
}

export type ContextOverrides = {
  /** Replace the AI provider (tests). `null` disables AI. */
  ai?: AiProvider | null
  /** fetch used for Telegram (tests). */
  telegramFetch?: FetchLike
  /** Gap between broadcast sends (tests). */
  telegramIntervalMs?: number
}

export async function createContext(config: Config, overrides: ContextOverrides = {}): Promise<AppContext> {
  registerSecret(config.adminPassword)
  registerSecret(config.sessionSecret)
  registerSecret(config.ai.anthropicKey)
  registerSecret(config.ai.apiKey)

  // DATA_DIR holds the session secret and customers' phone numbers: owner-only (best effort — e.g. a
  // bind mount owned by someone else). The Docker entrypoint chowns it to "node" before we get here.
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
  await tryChmod(config.dataDir, 0o700)
  const uploadsDir = path.join(config.dataDir, 'uploads')
  await mkdir(path.join(uploadsDir, 'images'), { recursive: true })
  await mkdir(path.join(uploadsDir, 'pdf'), { recursive: true })

  const content = new ContentStore(config.dataDir, config.seedContent)
  const leads = new LeadsStore(config.dataDir)
  const chats = new ChatsStore(config.dataDir)
  const settings = new SettingsStore(config.dataDir)
  const subscribers = new SubscribersStore(config.dataDir)
  await Promise.all([content.init(), leads.load(), chats.load(), settings.load(), subscribers.load()])

  let sessionSecret = config.sessionSecret ?? settings.get().sessionSecret
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('base64url')
    await settings.patch({ sessionSecret })
  }
  registerSecret(sessionSecret)

  const limits = {
    login: new RateLimiter(5, 10 * 60_000),
    loginGlobal: new RateLimiter(50, 10 * 60_000),
    leads: new RateLimiter(5, 10 * 60_000),
    leadsGlobal: new RateLimiter(config.leadsHourlyLimit, 60 * 60_000),
    telegram: new RateLimiter(TELEGRAM_HOURLY_LIMIT, 60 * 60_000),
    ai: new RateLimiter(config.ai.dailyLimit, 24 * 60 * 60_000),
    aiGlobal: new RateLimiter(config.ai.globalDailyLimit, 24 * 60 * 60_000),
  }

  const telegram = new Telegram({
    token: config.telegram.token,
    envChatId: config.telegram.chatId,
    envMode: config.telegram.mode,
    webhookSecret: config.telegram.webhookSecret,
    settings,
    subscribers,
    publicUrl: config.publicUrl,
    fetchImpl: overrides.telegramFetch,
    apiBase: config.telegram.apiBase,
    allowSend: () => limits.telegram.hit('global'),
    broadcastIntervalMs: overrides.telegramIntervalMs,
  })
  const ai = overrides.ai !== undefined ? overrides.ai : createProvider(config.ai)

  let keyCache = { epoch: -1, key: '' }

  const idle = async () => {
    await Promise.all([content.idle(), leads.idle(), chats.idle(), settings.idle(), subscribers.idle()])
  }

  return {
    config,
    content,
    leads,
    chats,
    settings,
    subscribers,
    telegram,
    ai,
    prompts: new PromptCache(),
    sessionSecret,
    sessionKey: () => {
      const epoch = settings.get().sessionEpoch ?? 0
      if (epoch !== keyCache.epoch) keyCache = { epoch, key: sessionKey(sessionSecret, config.adminPassword, epoch) }
      return keyCache.key
    },
    uploadsDir,
    limits,
    idle,
    async close() {
      await telegram.stopUpdates()
      for (const l of Object.values(limits)) l.stop()
      await idle()
    },
  }
}
