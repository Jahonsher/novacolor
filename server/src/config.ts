import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TRUSTED_PROXIES, TrustedProxies } from './rate-limit.js'

/** `mock` — deterministic offline replies for e2e tests; refused when NODE_ENV=production. */
export type AiProviderName = 'anthropic' | 'openai' | 'free' | 'mock' | 'off'

export type Config = {
  port: number
  host: string
  appDir: string
  dataDir: string
  staticDir: string
  seedContent: string
  adminPassword: string
  sessionSecret?: string
  publicUrl?: string
  trustProxy: boolean
  /** Peers whose forwarded headers are believed when trustProxy is on (TRUSTED_PROXIES). */
  trustedProxies: TrustedProxies
  telegram: {
    token?: string
    chatId?: string
    /** TELEGRAM_MODE (wins over the admin panel); undefined = admin panel / default. */
    mode?: TelegramMode
    /** TELEGRAM_WEBHOOK_SECRET: enables POST /api/telegram/webhook/<secret>. */
    webhookSecret?: string
    apiBase: string
  }
  ai: {
    provider: AiProviderName
    model: string
    anthropicKey?: string
    apiKey?: string
    baseUrl: string
    /** AI messages per IP (IPv6: per /64) per day. */
    dailyLimit: number
    /** AI messages per day across all visitors (cost cap). */
    globalDailyLimit: number
  }
  /** New leads per hour across all visitors (contact form + AI). */
  leadsHourlyLimit: number
}

export class ConfigError extends Error {}

/** `subscribers` — every active subscriber (/start) gets the leads; `single` — one chat (TELEGRAM_CHAT_ID / admin panel). */
export type TelegramMode = 'subscribers' | 'single'
export const TELEGRAM_MODES: readonly TelegramMode[] = ['subscribers', 'single']
/** Telegram allows A-Z a-z 0-9 _ - (1–256) for secret_token; we also require ≥ 16 characters. */
export const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/

/** Directory of the app: the nearest ancestor of this module that has package.json. */
export function findAppDir(start = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return process.cwd()
    dir = up
  }
}

const str = (v: string | undefined) => {
  const t = v?.trim()
  return t ? t : undefined
}

/** Non-negative integer from env, else the default. */
const count = (v: string | undefined, def: number) => {
  const n = Number(str(v) ?? def)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def
}

export const DEFAULT_MODELS: Record<Exclude<AiProviderName, 'off'>, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4o-mini',
  free: 'openai',
  mock: 'mock',
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appDir = path.resolve(str(env.APP_DIR) ?? findAppDir())
  const adminPassword = env.ADMIN_PASSWORD ?? ''
  if (adminPassword.length < 8) {
    throw new ConfigError(
      adminPassword
        ? "ADMIN_PASSWORD juda qisqa: kamida 8 belgi bo'lishi kerak. .env faylida yoki muhitda uzunroq parol kiriting."
        : "ADMIN_PASSWORD o'rnatilmagan. Server ishga tushmaydi: .env faylida yoki muhitda ADMIN_PASSWORD=... (kamida 8 belgi) ni kiriting.",
    )
  }

  const anthropicKey = str(env.ANTHROPIC_API_KEY)
  const apiKey = str(env.AI_API_KEY)
  const rawProvider = str(env.AI_PROVIDER)?.toLowerCase()
  let provider: AiProviderName
  if (rawProvider) {
    if (!['anthropic', 'openai', 'free', 'mock', 'off'].includes(rawProvider)) {
      throw new ConfigError(`AI_PROVIDER noto'g'ri: "${rawProvider}". Mumkin: anthropic | openai | free | off`)
    }
    if (rawProvider === 'mock' && env.NODE_ENV === 'production') {
      throw new ConfigError("AI_PROVIDER=mock faqat sinov uchun: NODE_ENV=production bo'lganda ishlatib bo'lmaydi")
    }
    provider = rawProvider as AiProviderName
  } else {
    // `free` (keyless, third-party) is never chosen implicitly: visitor messages may contain phone numbers
    provider = anthropicKey ? 'anthropic' : apiKey ? 'openai' : 'off'
  }

  const port = Number(env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`PORT noto'g'ri: ${env.PORT}`)
  const trustProxy = ['1', 'true', 'yes'].includes((env.TRUST_PROXY ?? '').toLowerCase())
  let trustedProxies: TrustedProxies
  try {
    const list = str(env.TRUSTED_PROXIES)
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    trustedProxies = new TrustedProxies(list?.length ? list : DEFAULT_TRUSTED_PROXIES)
  } catch (e) {
    throw new ConfigError((e as Error).message)
  }

  const tgMode = str(env.TELEGRAM_MODE)?.toLowerCase()
  if (tgMode && !TELEGRAM_MODES.includes(tgMode as TelegramMode)) {
    throw new ConfigError(`TELEGRAM_MODE noto'g'ri: "${tgMode}". Mumkin: subscribers | single`)
  }
  const webhookSecret = str(env.TELEGRAM_WEBHOOK_SECRET)
  if (webhookSecret && !WEBHOOK_SECRET_RE.test(webhookSecret)) {
    throw new ConfigError(
      "TELEGRAM_WEBHOOK_SECRET noto'g'ri: kamida 16 belgi, faqat A-Z a-z 0-9 _ - (masalan: openssl rand -hex 32)",
    )
  }

  return {
    port,
    // Behind a reverse proxy on the same host the app needs no public interface. (Docker sets HOST=0.0.0.0
    // inside the container; the published port is bound to the host's 127.0.0.1 via APP_BIND.)
    host: str(env.HOST) ?? (trustProxy ? '127.0.0.1' : '0.0.0.0'),
    appDir,
    dataDir: path.resolve(appDir, str(env.DATA_DIR) ?? 'data'),
    staticDir: path.resolve(appDir, str(env.STATIC_DIR) ?? 'dist'),
    seedContent: path.resolve(appDir, str(env.SEED_CONTENT) ?? 'src/data/content.json'),
    adminPassword,
    sessionSecret: str(env.SESSION_SECRET),
    publicUrl: str(env.PUBLIC_URL)?.replace(/\/+$/, ''),
    trustProxy,
    trustedProxies,
    telegram: {
      token: str(env.TELEGRAM_BOT_TOKEN) ?? str(env.telegram_bot_Token) ?? str(env.TELEGRAM_BOT_token),
      chatId: str(env.TELEGRAM_CHAT_ID),
      mode: tgMode as TelegramMode | undefined,
      webhookSecret,
      // self-hosted Bot API server, or a local fake in end-to-end tests
      apiBase: (str(env.TELEGRAM_API_BASE) ?? 'https://api.telegram.org').replace(/\/+$/, ''),
    },
    ai: {
      provider,
      model: str(env.AI_MODEL) ?? (provider === 'off' ? '' : DEFAULT_MODELS[provider]),
      anthropicKey,
      apiKey,
      baseUrl: (str(env.AI_BASE_URL) ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
      dailyLimit: count(env.AI_DAILY_LIMIT, 60),
      globalDailyLimit: count(env.AI_GLOBAL_DAILY_LIMIT, 500),
    },
    leadsHourlyLimit: count(env.LEADS_HOURLY_LIMIT, 60),
  }
}
